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
async fn balance_database_failure_keeps_authentication_and_billing_error_format() {
	// A closed lazy pool fails deterministically without connecting to any server.
	let database = PgPoolOptions::new()
		.connect_lazy("postgresql://unused@127.0.0.1:1/unused")
		.unwrap();
	database.close().await;
	let secret = b"test-secret-key-that-is-at-least-32-bytes-long";
	let token = issue_token(secret, "fixture", "", chrono::Utc::now().timestamp(), 3600).unwrap();
	let app = router_with_database(
		Security::new("https://slidesage.app"),
		ApiState {
			cache: None,
			database,
			auth: RequestAuth::new(secret, "slidesage_token"),
			rate_limit_secret: String::from_utf8(secret.to_vec()).unwrap(),
		},
	);
	for (authorization, status, message) in [
		(None, StatusCode::UNAUTHORIZED, "Unauthorized"),
		(
			Some("Bearer bad".to_owned()),
			StatusCode::UNAUTHORIZED,
			"Unauthorized",
		),
		(
			Some(format!("Bearer {token}")),
			StatusCode::INTERNAL_SERVER_ERROR,
			"Internal server error",
		),
	] {
		let mut request = Request::get("/billing/balance");
		if let Some(value) = authorization {
			request = request.header("authorization", value);
		}
		let response = app
			.clone()
			.oneshot(request.body(Body::empty()).unwrap())
			.await
			.unwrap();
		assert_eq!(response.status(), status);
		assert_eq!(
			response.headers()["content-type"],
			"application/json; charset=utf-8"
		);
		let body = to_bytes(response.into_body(), 1024).await.unwrap();
		assert!(body.ends_with(b"\n"));
		assert_eq!(
			serde_json::from_slice::<Value>(&body).unwrap(),
			json!({"error": {"message": message}})
		);
	}
}
