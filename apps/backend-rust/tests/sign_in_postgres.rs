#![cfg(feature = "postgres-tests")]

use std::net::{Ipv6Addr, SocketAddr};

use axum::{
	body::{Body, to_bytes},
	extract::ConnectInfo,
	http::Request,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use slidesage_backend::{
	auth::{jwt, password, request::RequestAuth},
	http::{ApiState, Security, router_with_database},
};
use sqlx::PgPool;
use tower::ServiceExt;

#[tokio::test]
async fn password_sign_in_issues_compatible_cookies_and_fails_closed() {
	let database = PgPool::connect(
		&std::env::var("TEST_DATABASE_URL")
			.expect("TEST_DATABASE_URL is required for postgres-tests"),
	)
	.await
	.unwrap();
	let user = uuid::Uuid::new_v4().to_string();
	let email = format!("signin-{user}@example.test");
	let password_text = "café-password";
	let hash = password::hash_password(password_text);
	sqlx::query(
		"INSERT INTO users(id,name,email,email_verified) VALUES($1,'Password fixture',$2,true)",
	)
	.bind(&user)
	.bind(&email)
	.execute(&database)
	.await
	.unwrap();
	sqlx::query("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2,'credential',$2,$3,NOW(),NOW())").bind(uuid::Uuid::new_v4().to_string()).bind(&user).bind(hash).execute(&database).await.unwrap();
	let secret = format!("test-secret-{user}");
	let ip = Ipv6Addr::from(*uuid::Uuid::new_v4().as_bytes());
	let state = |secure| ApiState {
		objects: None,
		cache: None,
		database: database.clone(),
		auth: RequestAuth::new(
			secret.as_bytes(),
			if secure {
				"__Secure-slidesage_token"
			} else {
				"slidesage_token"
			},
		)
		.with_secure_cookies(secure),
		rate_limit_secret: secret.clone(),
	};
	let request = |body: String| {
		let mut request = Request::post("/auth/sign-in/email")
			.body(Body::from(body))
			.unwrap();
		request
			.extensions_mut()
			.insert(ConnectInfo(SocketAddr::new(ip.into(), 40000)));
		request
	};
	for secure in [false, true] {
		let app = router_with_database(Security::new(""), state(secure));
		for persistent in [false, true] {
			let response = app.clone().oneshot(request(json!({"email": email.to_uppercase(), "password": "cafe\u{301}-password", "rememberMe": persistent}).to_string())).await.unwrap();
			assert_eq!(response.status(), 200);
			let cookie = response.headers()["set-cookie"]
				.to_str()
				.unwrap()
				.to_owned();
			assert_eq!(cookie.contains("Expires="), persistent);
			assert_eq!(cookie.contains("Secure; SameSite=None"), secure);
			assert_eq!(cookie.contains("SameSite=Lax"), !secure);
			assert!(cookie.contains("; Path=/;") && cookie.contains("HttpOnly"));
			let body: Value =
				serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap())
					.unwrap();
			let token = body["token"].as_str().unwrap();
			assert_eq!(jwt::verify_token(secret.as_bytes(), token).unwrap(), user);
			assert!(cookie.contains(token));
			assert_eq!(body["redirect"], false);
			assert_eq!(body["url"], Value::Null);
			assert_eq!(body["user"]["email"], email);
		}
	}
	let app = router_with_database(Security::new(""), state(false));
	sqlx::query("UPDATE users SET email_verified=false WHERE id=$1")
		.bind(&user)
		.execute(&database)
		.await
		.unwrap();
	let response = app
		.clone()
		.oneshot(request(
			json!({"email":email,"password":password_text}).to_string(),
		))
		.await
		.unwrap();
	assert_eq!(response.status(), 401);
	let body: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap()).unwrap();
	assert_eq!(body["code"], "EMAIL_NOT_VERIFIED");
	assert!(body.get("error").is_none());

	let email_key = hex::encode(Sha256::digest(format!(
		"{secret}\0auth-sign-in-email\0{email}"
	)));
	let ip_key = hex::encode(Sha256::digest(format!("{secret}\0auth-sign-in-ip\0{ip}")));
	sqlx::query("DELETE FROM users WHERE id=$1")
		.bind(&user)
		.execute(&database)
		.await
		.unwrap();
	sqlx::query("DELETE FROM api_rate_limits WHERE key_hash IN ($1,$2)")
		.bind(email_key)
		.bind(ip_key)
		.execute(&database)
		.await
		.unwrap();
	database.close().await;
	let response = app.oneshot(request("{}".into())).await.unwrap();
	assert_eq!(response.status(), 503);
	assert_eq!(
		response.headers()["content-type"],
		"application/json; charset=utf-8"
	);
	let body: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap()).unwrap();
	assert_eq!(body["error"]["code"], "RATE_LIMIT_UNAVAILABLE");
}
