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
	auth::request::RequestAuth,
	http::{ApiState, Security, router_with_database},
};
use sqlx::PgPool;
use tower::ServiceExt;

#[tokio::test]
async fn sign_in_options_reports_password_shape_and_handles_request_failures() {
	let database = PgPool::connect(
		&std::env::var("TEST_DATABASE_URL")
			.expect("TEST_DATABASE_URL is required for postgres-tests"),
	)
	.await
	.unwrap();
	let user = uuid::Uuid::new_v4().to_string();
	let email = format!("options-{user}@example.test");
	sqlx::query(
		"INSERT INTO users(id,name,email,email_verified) VALUES($1,'Options fixture',$2,false)",
	)
	.bind(&user)
	.bind(&email)
	.execute(&database)
	.await
	.unwrap();
	let secret = format!("options-secret-{user}");
	let ip = Ipv6Addr::from(*uuid::Uuid::new_v4().as_bytes());
	let app = router_with_database(
		Security::new(""),
		ApiState {
			cache: None,
			database: database.clone(),
			auth: RequestAuth::new(secret.as_bytes(), "slidesage_token"),
			rate_limit_secret: secret.clone(),
		},
	);
	let request = |body: String| {
		let mut request = Request::post("/auth/sign-in/options")
			.body(Body::from(body))
			.unwrap();
		request
			.extensions_mut()
			.insert(ConnectInfo(SocketAddr::new(ip.into(), 40000)));
		request
	};
	for (hash, expected) in [
		(None, false),
		(Some("reset-required".to_owned()), false),
		(
			Some(format!("{}:{}", "z".repeat(32), "g".repeat(128))),
			true,
		),
	] {
		sqlx::query("DELETE FROM accounts WHERE user_id=$1")
			.bind(&user)
			.execute(&database)
			.await
			.unwrap();
		if let Some(hash) = hash {
			sqlx::query("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2,'credential',$2,$3,NOW(),NOW())")
				.bind(uuid::Uuid::new_v4().to_string()).bind(&user).bind(hash).execute(&database).await.unwrap();
		}
		let response = app
			.clone()
			.oneshot(request(
				json!({"email": format!(" {} ", email.to_uppercase())}).to_string(),
			))
			.await
			.unwrap();
		assert_eq!(response.status(), 200);
		assert_eq!(response.headers()["content-type"], "application/json");
		assert!(response.headers().get("set-cookie").is_none());
		let body: Value =
			serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap()).unwrap();
		assert_eq!(body, json!({"hasPassword": expected}));
	}
	for (input, status, message) in [
		("{}".to_owned(), 400, "enter a valid email address"),
		("{\"email\":42}".to_owned(), 400, "Invalid request body"),
		(
			json!({"email": email, "password": "unknown field"}).to_string(),
			400,
			"Invalid request body",
		),
		(
			format!("{{\"email\":\"{}\"}}", "x".repeat(32768)),
			413,
			"Request body is too large",
		),
	] {
		let response = app.clone().oneshot(request(input)).await.unwrap();
		assert_eq!(response.status(), status);
		let body: Value =
			serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap()).unwrap();
		assert_eq!(body, json!({"error": {"message": message}}));
	}
	let response = app
		.clone()
		.oneshot(request(
			json!({"email": format!("unknown-{user}@example.test")}).to_string(),
		))
		.await
		.unwrap();
	assert_eq!(response.status(), 404);
	let body: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap()).unwrap();
	assert_eq!(body["code"], "ACCOUNT_NOT_FOUND");
	assert_eq!(
		body["message"],
		"No account exists for this email address. Create an account to continue."
	);
	let email_key = hex::encode(Sha256::digest(format!(
		"{secret}\0auth-sign-in-email\0{email}"
	)));
	let unknown_key = hex::encode(Sha256::digest(format!(
		"{secret}\0auth-sign-in-email\0unknown-{user}@example.test"
	)));
	let ip_key = hex::encode(Sha256::digest(format!("{secret}\0auth-sign-in-ip\0{ip}")));
	sqlx::query("DELETE FROM users WHERE id=$1")
		.bind(&user)
		.execute(&database)
		.await
		.unwrap();
	sqlx::query("DELETE FROM api_rate_limits WHERE key_hash IN ($1,$2,$3)")
		.bind(email_key)
		.bind(unknown_key)
		.bind(ip_key)
		.execute(&database)
		.await
		.unwrap();
	database.close().await;
	let response = app.oneshot(request("{}".to_owned())).await.unwrap();
	assert_eq!(response.status(), 503);
	let body: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap()).unwrap();
	assert_eq!(
		body,
		json!({"error": {"code": "RATE_LIMIT_UNAVAILABLE", "message": "Request protection is temporarily unavailable"}})
	);
}
