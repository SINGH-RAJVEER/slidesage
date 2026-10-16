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
async fn presentation_routes_preserve_auth_validation_and_closed_database_errors() {
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
			rate_limit_secret: String::new(),
		},
	);
	for (method, path, authenticated, status, message) in [
		(
			"GET",
			"/presentations",
			false,
			401,
			"Authentication required",
		),
		(
			"GET",
			"/presentations/fixture",
			false,
			401,
			"Authentication required",
		),
		(
			"DELETE",
			"/presentations/fixture",
			false,
			401,
			"Authentication required",
		),
		(
			"GET",
			"/presentations?limit=bad",
			false,
			401,
			"Authentication required",
		),
		(
			"GET",
			"/presentations?limit=bad",
			true,
			400,
			"limit must be between 1 and 100",
		),
		(
			"GET",
			"/presentations?offset=%20",
			true,
			400,
			"offset must be an integer",
		),
		(
			"GET",
			"/presentations",
			true,
			400,
			"count presentations: sql: database is closed",
		),
		(
			"GET",
			"/presentations/fixture",
			true,
			400,
			"scan presentation: sql: database is closed",
		),
		(
			"DELETE",
			"/presentations/fixture",
			true,
			400,
			"delete presentation: sql: database is closed",
		),
	] {
		let mut request = Request::builder().method(method).uri(path);
		if authenticated {
			request = request.header("authorization", format!("Bearer {token}"));
		}
		let response = app
			.clone()
			.oneshot(request.body(Body::empty()).unwrap())
			.await
			.unwrap();
		assert_eq!(
			response.status(),
			StatusCode::from_u16(status).unwrap(),
			"{method} {path}"
		);
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
