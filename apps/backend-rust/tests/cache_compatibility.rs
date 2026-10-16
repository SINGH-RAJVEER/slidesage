//! Go TestListCacheTracksCommittedWrites assertions against the Rust HTTP routes.

#![cfg(feature = "postgres-tests")]

use std::{
	collections::HashMap,
	sync::{
		Arc, Mutex,
		atomic::{AtomicUsize, Ordering},
	},
	time::Duration,
};

use axum::{
	Router,
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::Value;
use slidesage_backend::{
	auth::{jwt::issue_token, request::RequestAuth},
	cache::{CacheFuture, Store},
	http::{ApiState, Security, router_with_database},
};
use sqlx::PgPool;
use tower::ServiceExt;

const SECRET: &[u8] = b"test-secret-key-that-is-at-least-32-bytes-long";

#[derive(Default)]
struct ListCache {
	values: Mutex<HashMap<String, Vec<u8>>>,
	before_set: Mutex<Option<(PgPool, String)>>,
	fills: AtomicUsize,
}

impl Store for ListCache {
	fn get<'a>(&'a self, key: &'a str) -> CacheFuture<'a, Option<Vec<u8>>> {
		Box::pin(async move { self.values.lock().unwrap().get(key).cloned() })
	}

	fn set<'a>(&'a self, key: &'a str, value: &'a [u8], ttl: Duration) -> CacheFuture<'a, ()> {
		Box::pin(async move {
			assert_eq!(ttl, Duration::from_secs(30));
			let hook = self.before_set.lock().unwrap().take();
			if let Some((pool, id)) = hook {
				sqlx::query("UPDATE presentations SET title = 'Newer' WHERE id = $1")
					.bind(id)
					.execute(&pool)
					.await
					.unwrap();
			}
			self.fills.fetch_add(1, Ordering::SeqCst);
			self.values
				.lock()
				.unwrap()
				.insert(key.to_owned(), value.to_vec());
		})
	}
}

async fn list(app: &Router, user: &str) -> Value {
	let token = issue_token(SECRET, user, "", chrono::Utc::now().timestamp(), 3600).unwrap();
	let response = app
		.clone()
		.oneshot(
			Request::get("/presentations")
				.header("authorization", format!("Bearer {token}"))
				.body(Body::empty())
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::OK);
	serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap()).unwrap()
}

#[tokio::test]
async fn list_cache_tracks_committed_writes_and_never_reactivates_late_fills() {
	let url = std::env::var("TEST_DATABASE_URL")
		.expect("TEST_DATABASE_URL is required with postgres-tests");
	let database = PgPool::connect(&url).await.unwrap();
	let user = format!("rust-cache-{}", uuid::Uuid::new_v4());
	let other = format!("{user}-other");
	sqlx::query("INSERT INTO users (id, name, email) VALUES ($1, 'Cache', $1 || '@test.invalid'), ($2, 'Cache', $2 || '@test.invalid')")
		.bind(&user).bind(&other).execute(&database).await.unwrap();
	sqlx::query("INSERT INTO presentations (id, user_id, title, prompt, slides_data) VALUES ($1, $1, 'Original', 'Prompt', '{\"status\":\"ready\",\"totalSlides\":2}')")
		.bind(&user).execute(&database).await.unwrap();
	let cache = Arc::new(ListCache::default());
	let app = router_with_database(
		Security::new("https://slidesage.app"),
		ApiState {
			database: database.clone(),
			auth: RequestAuth::new(SECRET, "slidesage_token"),
			rate_limit_secret: String::new(),
			cache: Some(cache.clone()),
		},
	);
	let first = list(&app, &user).await;
	assert_eq!(first["presentations"][0]["title"], "Original");
	assert_eq!(first["presentations"][0]["slide_count"], 2);
	assert_eq!(cache.fills.load(Ordering::SeqCst), 1);
	// The generation table remains readable, while any count/list query on
	// presentation bodies would block. A genuine cache hit must finish anyway.
	let mut lock = database.begin().await.unwrap();
	sqlx::query("LOCK TABLE presentations IN ACCESS EXCLUSIVE MODE")
		.execute(&mut *lock)
		.await
		.unwrap();
	let hit = tokio::time::timeout(Duration::from_secs(1), list(&app, &user))
		.await
		.expect("cache hit queried locked presentation bodies");
	assert_eq!(hit, first);
	lock.rollback().await.unwrap();
	assert_eq!(cache.fills.load(Ordering::SeqCst), 1);
	assert_eq!(
		list(&app, &other).await["presentations"],
		serde_json::json!([])
	);

	sqlx::query("UPDATE presentations SET title = 'Worker write' WHERE id = $1")
		.bind(&user)
		.execute(&database)
		.await
		.unwrap();
	assert_eq!(
		list(&app, &user).await["presentations"][0]["title"],
		"Worker write"
	);
	let mut transaction = database.begin().await.unwrap();
	sqlx::query("UPDATE presentations SET title = 'Rolled back' WHERE id = $1")
		.bind(&user)
		.execute(&mut *transaction)
		.await
		.unwrap();
	transaction.rollback().await.unwrap();
	let fills = cache.fills.load(Ordering::SeqCst);
	assert_eq!(
		list(&app, &user).await["presentations"][0]["title"],
		"Worker write"
	);
	assert_eq!(
		cache.fills.load(Ordering::SeqCst),
		fills,
		"rollback changed cache generation"
	);

	cache.values.lock().unwrap().clear();
	*cache.before_set.lock().unwrap() = Some((database.clone(), user.clone()));
	assert_eq!(
		list(&app, &user).await["presentations"][0]["title"],
		"Worker write"
	);
	assert_eq!(
		list(&app, &user).await["presentations"][0]["title"],
		"Newer",
		"late fill reactivated stale content"
	);

	sqlx::query("UPDATE presentations SET user_id = $1 WHERE id = $2")
		.bind(&other)
		.bind(&user)
		.execute(&database)
		.await
		.unwrap();
	assert_eq!(
		list(&app, &user).await["presentations"],
		serde_json::json!([])
	);
	assert_eq!(
		list(&app, &other).await["presentations"][0]["title"],
		"Newer"
	);
	let token = issue_token(SECRET, &other, "", chrono::Utc::now().timestamp(), 3600).unwrap();
	let deleted = app
		.clone()
		.oneshot(
			Request::delete(format!("/presentations/{user}"))
				.header("authorization", format!("Bearer {token}"))
				.body(Body::empty())
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
	assert_eq!(
		list(&app, &other).await["presentations"],
		serde_json::json!([])
	);

	sqlx::query("INSERT INTO presentations (id, user_id, title, prompt, slides_data) VALUES ($1, $1, 'Delete account', 'Prompt', '{}')")
		.bind(&user).execute(&database).await.unwrap();
	assert_eq!(
		list(&app, &user).await["presentations"][0]["title"],
		"Delete account"
	);
	sqlx::query("DELETE FROM users WHERE id = $1")
		.bind(&user)
		.execute(&database)
		.await
		.unwrap();
	assert_eq!(
		list(&app, &user).await["presentations"],
		serde_json::json!([])
	);

	for corrupt in [
		&b"broken JSON"[..],
		&br#"{"Summaries":null,"Total":0,"HasMore":false}"#[..],
	] {
		for value in cache.values.lock().unwrap().values_mut() {
			*value = corrupt.to_vec();
		}
		let fills = cache.fills.load(Ordering::SeqCst);
		assert_eq!(
			list(&app, &other).await["presentations"],
			serde_json::json!([])
		);
		assert_eq!(
			cache.fills.load(Ordering::SeqCst),
			fills + 1,
			"corrupt cache did not fall back to PostgreSQL"
		);
	}

	// A cached result never bypasses an unavailable authoritative generation read.
	database.close().await;
	let token = issue_token(SECRET, &other, "", chrono::Utc::now().timestamp(), 3600).unwrap();
	let response = app
		.oneshot(
			Request::get("/presentations")
				.header("authorization", format!("Bearer {token}"))
				.body(Body::empty())
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::BAD_REQUEST);
	let cleanup = PgPool::connect(&url).await.unwrap();
	sqlx::query("DELETE FROM users WHERE id IN ($1, $2)")
		.bind(&user)
		.bind(&other)
		.execute(&cleanup)
		.await
		.unwrap();
	sqlx::query("DELETE FROM presentation_cache_versions WHERE user_id IN ($1, $2)")
		.bind(&user)
		.bind(&other)
		.execute(&cleanup)
		.await
		.unwrap();
	cleanup.close().await;
}
