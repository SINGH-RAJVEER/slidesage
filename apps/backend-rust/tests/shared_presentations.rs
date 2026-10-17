#![cfg(feature = "postgres-tests")]

use axum::{
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use slidesage_backend::{
	auth::request::RequestAuth,
	cache::{CacheFuture, Store},
	http::ApiState,
};
use std::{
	collections::HashMap,
	sync::{
		Arc, Mutex,
		atomic::{AtomicUsize, Ordering},
	},
	time::Duration,
};
use tower::ServiceExt;

#[derive(Default)]
struct Cache {
	entries: Mutex<HashMap<String, Vec<u8>>>,
	gets: AtomicUsize,
}
impl Store for Cache {
	fn get<'a>(&'a self, key: &'a str) -> CacheFuture<'a, Option<Vec<u8>>> {
		Box::pin(async move {
			self.gets.fetch_add(1, Ordering::SeqCst);
			self.entries.lock().unwrap().get(key).cloned()
		})
	}
	fn set<'a>(&'a self, key: &'a str, value: &'a [u8], _: Duration) -> CacheFuture<'a, ()> {
		Box::pin(async move {
			self.entries
				.lock()
				.unwrap()
				.insert(key.to_owned(), value.to_vec());
		})
	}
}

async fn call(app: &axum::Router, token: &str, expected: StatusCode) -> Value {
	let response = app
		.clone()
		.oneshot(
			Request::get(format!("/shared/{token}"))
				.header("authorization", "Bearer invalid")
				.body(Body::empty())
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), expected);
	assert_eq!(response.headers()["cache-control"], "private, no-store");
	assert_eq!(response.headers()["content-type"], "application/json");
	serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap()
}

#[tokio::test]
async fn public_reads_resolve_live_tokens_and_current_owners_before_cached_bodies() {
	let database = sqlx::PgPool::connect(
		&std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL required"),
	)
	.await
	.unwrap();
	let owner = uuid::Uuid::new_v4().to_string();
	let other = format!("other-{owner}");
	let id = format!("public-{owner}");
	let token = "_".repeat(43);
	let digest = hex::encode(Sha256::digest(token.as_bytes()));
	sqlx::query("INSERT INTO users(id,name,email) VALUES($1,'Share',$1 || '@test.invalid'),($2,'Other',$2 || '@test.invalid')").bind(&owner).bind(&other).execute(&database).await.unwrap();
	sqlx::query("INSERT INTO presentations(id,user_id,title,prompt,slides_data) VALUES($1,$2,'Public','private prompt','{\"status\":\"ready\",\"sources\":[{\"url\":\"citation\",\"title\":9,\"snippet\":\"private notes\"},false]}')").bind(&id).bind(&owner).execute(&database).await.unwrap();
	sqlx::query("INSERT INTO presentation_shares(id,presentation_id,token_sha256,created_by) VALUES($1::text::uuid,$2,$3,$4)").bind(uuid::Uuid::new_v4().to_string()).bind(&id).bind(&digest).bind(&owner).execute(&database).await.unwrap();
	let cache = Arc::new(Cache::default());
	let app = slidesage_backend::shared_presentations::router(ApiState {
		database: database.clone(),
		auth: RequestAuth::new(b"unused-public-test-secret", "slidesage_token"),
		rate_limit_secret: "unused".into(),
		cache: Some(cache.clone()),
	});
	call(&app, "bad", StatusCode::NOT_FOUND).await;
	call(&app, &token, StatusCode::NOT_FOUND).await;
	let document = r#"{"schemaVersion":3,"cardOrder":["c"],"title":"Public deck","precise":123456789012345678901234567890,"cards":{"c":{"nodes":[]}}}"#;
	sqlx::query("INSERT INTO card_revisions(presentation_id,revision,sha256,byte_size,card_count,schema_version,author_id,operation_kind,operation_id,document) VALUES($1,1,$2,$3,1,3,$4,'generation','public-fixture',$5::jsonb)").bind(&id).bind("a".repeat(64)).bind(document.len() as i64).bind(&owner).bind(document).execute(&database).await.unwrap();
	sqlx::query("UPDATE presentations SET current_card_revision=1 WHERE id=$1")
		.bind(&id)
		.execute(&database)
		.await
		.unwrap();
	let body = call(&app, &token, StatusCode::OK).await;
	assert_eq!(body.as_object().unwrap().len(), 3);
	assert_eq!(body["document"]["title"], "Public deck");
	assert_eq!(
		body["sources"],
		serde_json::json!([{"url":"citation"},{"url":""}])
	);
	assert_eq!(cache.entries.lock().unwrap().len(), 1);
	call(&app, &token, StatusCode::OK).await;
	assert_eq!(cache.entries.lock().unwrap().len(), 1);
	sqlx::query("UPDATE presentations SET user_id=$1,slides_data='{\"status\":\"ready\",\"sources\":[{\"url\":\"fresh\"}]}' WHERE id=$2").bind(&other).bind(&id).execute(&database).await.unwrap();
	assert_eq!(
		call(&app, &token, StatusCode::OK).await["sources"][0]["url"],
		"fresh"
	);
	assert_eq!(
		cache.entries.lock().unwrap().len(),
		2,
		"owner-specific cache key"
	);
	let reads = cache.gets.load(Ordering::SeqCst);
	sqlx::query("UPDATE presentation_shares SET revoked_at=now() WHERE presentation_id=$1")
		.bind(&id)
		.execute(&database)
		.await
		.unwrap();
	call(&app, &token, StatusCode::NOT_FOUND).await;
	assert_eq!(
		cache.gets.load(Ordering::SeqCst),
		reads,
		"revocation precedes any cached body lookup"
	);
	sqlx::query("DELETE FROM presentations WHERE id=$1")
		.bind(&id)
		.execute(&database)
		.await
		.unwrap();
	call(&app, &token, StatusCode::NOT_FOUND).await;
	sqlx::query("DELETE FROM users WHERE id=ANY($1)")
		.bind(vec![owner.clone(), other.clone()])
		.execute(&database)
		.await
		.unwrap();
	sqlx::query("DELETE FROM presentation_cache_versions WHERE user_id=ANY($1)")
		.bind(vec![owner, other])
		.execute(&database)
		.await
		.unwrap();
	database.close().await;
}
