use axum::{
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::{Value, json};
use slidesage_backend::{
	auth::{jwt::issue_token, request::RequestAuth},
	http::{ApiState, Security, router_with_database},
};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn auth_reads_and_sign_out_preserve_closed_database_and_cookie_behavior() {
	let database = PgPoolOptions::new()
		.connect_lazy("postgresql://unused@127.0.0.1:1/unused")
		.unwrap();
	database.close().await;
	let secret = b"test-secret-key-that-is-at-least-32-bytes-long";
	let token = issue_token(secret, "fixture", "", chrono::Utc::now().timestamp(), 3600).unwrap();
	for (secure, cookie_name, expected_cookie) in [
		(
			false,
			"slidesage_token",
			"slidesage_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
		),
		(
			true,
			"__Secure-slidesage_token",
			"__Secure-slidesage_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None",
		),
	] {
		let app = router_with_database(
			Security::new("https://slidesage.app"),
			ApiState {
				cache: None,
				database: database.clone(),
				auth: RequestAuth::new(secret, cookie_name).with_secure_cookies(secure),
				rate_limit_secret: String::new(),
			},
		);
		for (method, path, authenticated, expected_status, expected_body) in [
			("GET", "/auth/get-session", false, 200, Value::Null),
			("GET", "/auth/get-session", true, 200, Value::Null),
			(
				"GET",
				"/profile",
				false,
				401,
				json!({"error":{"message":"Unauthorized"}}),
			),
			(
				"GET",
				"/profile",
				true,
				401,
				json!({"error":{"message":"Unauthorized"}}),
			),
			(
				"POST",
				"/auth/sign-out",
				false,
				200,
				json!({"success":true}),
			),
			("POST", "/auth/sign-out", true, 200, json!({"success":true})),
		] {
			let mut request = Request::builder().method(method).uri(path);
			if authenticated {
				request = request.header("Authorization", format!("Bearer {token}"));
			}
			let result = app
				.clone()
				.oneshot(request.body(Body::from("not JSON")).unwrap())
				.await
				.unwrap();
			assert_eq!(
				result.status(),
				StatusCode::from_u16(expected_status).unwrap()
			);
			assert_eq!(result.headers()["content-type"], "application/json");
			if path == "/auth/sign-out" {
				assert_eq!(result.headers()["set-cookie"], expected_cookie);
			} else {
				assert!(!result.headers().contains_key("set-cookie"));
			}
			let body = to_bytes(result.into_body(), 1024).await.unwrap();
			assert!(body.ends_with(b"\n"));
			assert_eq!(
				serde_json::from_slice::<Value>(&body).unwrap(),
				expected_body
			);
		}
	}
}
