#![cfg(feature = "postgres-tests")]

use axum::{
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use slidesage_backend::{
	auth::{jwt::issue_token, request::RequestAuth},
	http::ApiState,
};
use tower::ServiceExt;

#[tokio::test]
async fn share_management_preserves_rotation_digest_privacy_and_revocation() {
	let database = sqlx::PgPool::connect(
		&std::env::var("TEST_DATABASE_URL")
			.expect("TEST_DATABASE_URL is required for postgres-tests"),
	)
	.await
	.unwrap();
	let owner = uuid::Uuid::new_v4().to_string();
	let id = format!("share-{owner}");
	sqlx::query("INSERT INTO users (id,name,email) VALUES($1,'Share fixture',$2)")
		.bind(&owner)
		.bind(format!("{owner}@test.invalid"))
		.execute(&database)
		.await
		.unwrap();
	sqlx::query("INSERT INTO presentations (id,user_id,title,prompt,slides_data) VALUES($1,$2,'Share','Prompt','{}')").bind(&id).bind(&owner).execute(&database).await.unwrap();
	let secret = b"share-test-secret-with-at-least-32-bytes";
	let token = issue_token(secret, &owner, "", chrono::Utc::now().timestamp(), 3600).unwrap();
	let state = ApiState {
		database: database.clone(),
		auth: RequestAuth::new(secret, "slidesage_token"),
		rate_limit_secret: String::from_utf8(secret.to_vec()).unwrap(),
		cache: None,
	};
	let app = slidesage_backend::shares::router(state);
	let path = format!("/presentations/{id}/share");
	let response = app
		.clone()
		.oneshot(Request::post(&path).body(Body::empty()).unwrap())
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
	let mut old_digest = String::new();
	for rotation in 0..2 {
		let response = app
			.clone()
			.oneshot(
				Request::post(&path)
					.header("authorization", format!("Bearer {token}"))
					.body(Body::from("broken JSON is ignored"))
					.unwrap(),
			)
			.await
			.unwrap();
		assert_eq!(response.status(), StatusCode::CREATED);
		assert_eq!(response.headers()["cache-control"], "private, no-store");
		let body: Value =
			serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
		let share = &body["share"];
		let issued = share["token"].as_str().unwrap();
		assert_eq!(issued.len(), 43);
		let digest = hex::encode(Sha256::digest(issued.as_bytes()));
		let (stored,created_by,created_at):(String,String,chrono::DateTime<chrono::Utc>) = sqlx::query_as("SELECT token_sha256,created_by,created_at FROM presentation_shares WHERE presentation_id=$1 AND revoked_at IS NULL").bind(&id).fetch_one(&database).await.unwrap();
		assert_eq!(stored, digest);
		assert_eq!(created_by, owner);
		assert_eq!(
			chrono::DateTime::parse_from_rfc3339(share["createdAt"].as_str().unwrap()).unwrap(),
			created_at
		);
		let total: i64 =
			sqlx::query_scalar("SELECT count(*) FROM presentation_shares WHERE presentation_id=$1")
				.bind(&id)
				.fetch_one(&database)
				.await
				.unwrap();
		assert_eq!(total, rotation + 1);
		if rotation == 1 {
			let revoked: bool = sqlx::query_scalar(
				"SELECT revoked_at IS NOT NULL FROM presentation_shares WHERE token_sha256=$1",
			)
			.bind(&old_digest)
			.fetch_one(&database)
			.await
			.unwrap();
			assert!(revoked);
		}
		old_digest = digest;
		let response = app
			.clone()
			.oneshot(
				Request::get(&path)
					.header("cookie", format!("slidesage_token={token}"))
					.body(Body::empty())
					.unwrap(),
			)
			.await
			.unwrap();
		assert_eq!(response.status(), StatusCode::OK);
		let current: Value =
			serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
		assert_eq!(current["share"]["createdAt"], share["createdAt"]);
		assert!(current["share"].get("token").is_none());
	}
	for _ in 0..2 {
		let response = app
			.clone()
			.oneshot(
				Request::delete(&path)
					.header("authorization", format!("Bearer {token}"))
					.body(Body::empty())
					.unwrap(),
			)
			.await
			.unwrap();
		assert_eq!(response.status(), StatusCode::NO_CONTENT);
		assert!(!response.headers().contains_key("content-type"));
		assert!(!response.headers().contains_key("cache-control"));
		assert!(
			to_bytes(response.into_body(), 4096)
				.await
				.unwrap()
				.is_empty()
		);
	}
	let live: i64 = sqlx::query_scalar(
		"SELECT count(*) FROM presentation_shares WHERE presentation_id=$1 AND revoked_at IS NULL",
	)
	.bind(&id)
	.fetch_one(&database)
	.await
	.unwrap();
	assert_eq!(live, 0);
	sqlx::query("DELETE FROM users WHERE id=$1")
		.bind(&owner)
		.execute(&database)
		.await
		.unwrap();
	sqlx::query("DELETE FROM presentation_cache_versions WHERE user_id=$1")
		.bind(&owner)
		.execute(&database)
		.await
		.unwrap();
	database.close().await;
}
