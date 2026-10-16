//! Explicit database suite: --features postgres-tests requires TEST_DATABASE_URL.

use axum::{
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::{Value, json};
use slidesage_backend::{
	auth::{jwt::issue_token, request::RequestAuth},
	http::{ApiState, Security, router_with_database},
};
use sqlx::PgPool;
use tower::ServiceExt;

#[tokio::test]
async fn feedback_preserves_validation_authentication_and_postgres_effects() {
	let database = PgPool::connect(
		&std::env::var("TEST_DATABASE_URL")
			.expect("TEST_DATABASE_URL is required for postgres-tests"),
	)
	.await
	.unwrap();
	let user = uuid::Uuid::new_v4().to_string();
	sqlx::query("INSERT INTO users (id, name, email) VALUES ($1, 'Rust feedback fixture', $2)")
		.bind(&user)
		.bind(format!("{user}@example.test"))
		.execute(&database)
		.await
		.unwrap();
	let secret = b"test-secret-key-that-is-at-least-32-bytes-long";
	let token = issue_token(secret, &user, "", chrono::Utc::now().timestamp(), 3600).unwrap();
	let app = router_with_database(
		Security::new("https://slidesage.app"),
		ApiState {
			cache: None,
			database: database.clone(),
			auth: RequestAuth::new(secret, "slidesage_token"),
			rate_limit_secret: String::from_utf8(secret.to_vec()).unwrap(),
		},
	);
	assert_eq!(
		app.clone()
			.oneshot(Request::get("/feedback").body(Body::empty()).unwrap())
			.await
			.unwrap()
			.status(),
		StatusCode::NOT_FOUND
	);
	use sha2::{Digest, Sha256};
	let key_hash = hex::encode(Sha256::digest(
		[secret.as_slice(), b"\0feedback-submit\0", user.as_bytes()].concat(),
	));
	let long_body = json!({"message": "é".repeat(4001)}).to_string();
	let oversized = json!({"message": "x".repeat(33 * 1024)}).to_string();
	let cookie = format!("slidesage_token={token}");
	let quoted_cookie = format!("irrelevant=x; slidesage_token=\"{token}\"");
	for (body, auth_header, cookie_header, expected, saved) in [
		("{\"message\":\"hi\"}", None, None, 401, None),
		(
			"{\"message\":\"   \"}",
			Some(token.as_str()),
			None,
			400,
			None,
		),
		(
			"{\"message\":\"hi\",\"rating\":5}",
			Some(token.as_str()),
			None,
			400,
			None,
		),
		(long_body.as_str(), Some(token.as_str()), None, 400, None),
		(
			"{\"message\":\"  Love the themes  \"}",
			Some(token.as_str()),
			None,
			201,
			Some("Love the themes"),
		),
		(
			"{\"Message\":\"  Love the themes  \"}",
			None,
			Some(cookie.as_str()),
			201,
			Some("Love the themes"),
		),
		(
			"{\"message\":\"hi\"}",
			Some("bad-token"),
			Some(cookie.as_str()),
			401,
			None,
		),
		(
			"{\"message\":\"hi\"}",
			None,
			Some(quoted_cookie.as_str()),
			201,
			Some("hi"),
		),
		(
			"{\"message\":\"hi\"} {}",
			Some(token.as_str()),
			None,
			400,
			None,
		),
		("null", Some(token.as_str()), None, 400, None),
		("{\"message\":null}", Some(token.as_str()), None, 400, None),
		("{\"message\":42}", Some(token.as_str()), None, 400, None),
		(
			"{\"message\":\"hi\",\"message\":null}",
			Some(token.as_str()),
			None,
			201,
			Some("hi"),
		),
		(oversized.as_str(), Some(token.as_str()), None, 413, None),
		(oversized.as_str(), None, None, 401, None),
	] {
		// Each validation case starts with its own empty rate window.
		sqlx::query(
			"DELETE FROM api_rate_limits WHERE scope = 'feedback-submit' AND key_hash = $1",
		)
		.bind(&key_hash)
		.execute(&database)
		.await
		.unwrap();
		let mut request = Request::post("/feedback");
		if let Some(token) = auth_header {
			request = request.header("authorization", format!("Bearer {token}"));
		}
		if let Some(cookie) = cookie_header {
			request = request.header("cookie", cookie);
		}
		let before: i64 = sqlx::query_scalar("SELECT count(*) FROM feedback WHERE user_id = $1")
			.bind(&user)
			.fetch_one(&database)
			.await
			.unwrap();
		let response = app
			.clone()
			.oneshot(request.body(Body::from(body.to_owned())).unwrap())
			.await
			.unwrap();
		assert_eq!(response.status().as_u16(), expected, "{body:.100}");
		assert_eq!(
			response.headers()["content-type"],
			"application/json; charset=utf-8"
		);
		let payload: Value =
			serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
		let after: i64 = sqlx::query_scalar("SELECT count(*) FROM feedback WHERE user_id = $1")
			.bind(&user)
			.fetch_one(&database)
			.await
			.unwrap();
		assert_eq!(after - before, i64::from(saved.is_some()));
		if let Some(saved) = saved {
			let id = payload["feedback"]["id"].as_str().unwrap();
			assert_eq!(uuid::Uuid::parse_str(id).unwrap().get_version_num(), 4);
			let stored: String =
				sqlx::query_scalar("SELECT message FROM feedback WHERE id = $1 AND user_id = $2")
					.bind(id)
					.bind(&user)
					.fetch_one(&database)
					.await
					.unwrap();
			assert_eq!(stored, saved);
			chrono::DateTime::parse_from_rfc3339(
				payload["feedback"]["created_at"].as_str().unwrap(),
			)
			.unwrap();
		} else {
			assert!(payload["error"]["message"].is_string());
		}
	}
	// Match the Go fast JWT identity path: a deleted/nonexistent user reaches the FK failure.
	let missing_user = issue_token(
		secret,
		"missing-user",
		"",
		chrono::Utc::now().timestamp(),
		3600,
	)
	.unwrap();
	let response = app
		.clone()
		.oneshot(
			Request::post("/feedback")
				.header("authorization", format!("Bearer {missing_user}"))
				.body(Body::from("{\"message\":\"hi\"}"))
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
	let payload: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
	assert_eq!(
		payload,
		json!({"error": {"message": "Could not save feedback"}})
	);
	for attempt in 1..=11 {
		let response = app
			.clone()
			.oneshot(
				Request::post("/feedback")
					.header("authorization", format!("Bearer {token}"))
					.body(Body::from("{\"message\":\" \"}"))
					.unwrap(),
			)
			.await
			.unwrap();
		assert_eq!(
			response.status().as_u16(),
			if attempt <= 10 { 400 } else { 429 }
		);
		if attempt == 11 {
			let retry = response.headers()["retry-after"]
				.to_str()
				.unwrap()
				.parse::<i64>()
				.unwrap();
			assert!((1..=3600).contains(&retry));
			let payload: Value =
				serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap())
					.unwrap();
			assert_eq!(
				payload,
				json!({"error":{"code":"RATE_LIMITED", "message":"Too many requests"}, "retry_after":retry})
			);
		}
	}
	let count: i32 = sqlx::query_scalar(
		"SELECT request_count FROM api_rate_limits WHERE scope = 'feedback-submit' AND key_hash = $1",
	)
	.bind(&key_hash)
	.fetch_one(&database)
	.await
	.unwrap();
	assert_eq!(count, 11);
	sqlx::query("DELETE FROM users WHERE id = $1")
		.bind(&user)
		.execute(&database)
		.await
		.unwrap();
	database.close().await;
	let response = app
		.oneshot(
			Request::post("/feedback")
				.header("authorization", format!("Bearer {token}"))
				.body(Body::from("{\"message\":\"hi\"}"))
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
	let payload: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
	assert_eq!(
		payload,
		json!({"error":{"code":"RATE_LIMIT_UNAVAILABLE", "message":"Request protection is temporarily unavailable"}})
	);
}
