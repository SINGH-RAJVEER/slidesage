use axum::{
	Router,
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::{Value, json};
use slidesage_backend::{
	auth::{jwt::issue_token, request::RequestAuth},
	http::{ApiState, Security, router_with_database},
};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower::ServiceExt;

const SECRET: &[u8] = b"test-secret-key-that-is-at-least-32-bytes-long";

fn app(
	database: PgPool,
	cache: Option<std::sync::Arc<dyn slidesage_backend::cache::Store>>,
) -> Router {
	router_with_database(
		Security::new("https://slidesage.app"),
		ApiState {
			objects: None,
			database,
			auth: RequestAuth::new(SECRET, "slidesage_token"),
			rate_limit_secret: String::new(),
			cache,
		},
	)
}

async fn read(app: &Router, id: &str, user: Option<&str>, status: StatusCode) -> Value {
	let mut request = Request::get(format!("/presentations/{id}/document"));
	if let Some(user) = user {
		let token = issue_token(SECRET, user, "", chrono::Utc::now().timestamp(), 3600).unwrap();
		request = request.header("authorization", format!("Bearer {token}"));
	}
	let response = app
		.clone()
		.oneshot(request.body(Body::empty()).unwrap())
		.await
		.unwrap();
	assert_eq!(response.status(), status);
	assert_eq!(response.headers()["content-type"], "application/json");
	assert_eq!(response.headers()["cache-control"], "private, no-store");
	let bytes = to_bytes(response.into_body(), 4 << 20).await.unwrap();
	assert!(bytes.ends_with(b"\n"));
	serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn document_read_authentication_precedes_database_and_errors_preserve_go_headers() {
	let database = PgPoolOptions::new()
		.connect_lazy("postgresql://unused@127.0.0.1:1/unused")
		.unwrap();
	database.close().await;
	let app = app(database, None);
	assert_eq!(
		read(&app, "id", None, StatusCode::UNAUTHORIZED).await,
		json!({"error":{"message":"Authentication required"}})
	);
	assert_eq!(
		read(&app, "id", Some("user"), StatusCode::INTERNAL_SERVER_ERROR).await,
		json!({"error":{"message":"Unable to load the presentation"}})
	);
}

#[cfg(feature = "postgres-tests")]
mod postgres {
	use super::*;
	use sha2::{Digest, Sha256};
	use slidesage_backend::cache::{CacheFuture, Store};
	use std::{
		collections::HashMap,
		sync::{
			Arc, Mutex,
			atomic::{AtomicUsize, Ordering},
		},
		time::Duration,
	};

	#[derive(Default)]
	struct BodyCache {
		values: Mutex<HashMap<String, Vec<u8>>>,
		gets: AtomicUsize,
		fills: AtomicUsize,
		transfer_on_get: Mutex<Option<(PgPool, String, String)>>,
	}

	impl Store for BodyCache {
		fn get<'a>(&'a self, key: &'a str) -> CacheFuture<'a, Option<Vec<u8>>> {
			Box::pin(async move {
				self.gets.fetch_add(1, Ordering::SeqCst);
				let transfer = self.transfer_on_get.lock().unwrap().take();
				if let Some((database, id, owner)) = transfer {
					sqlx::query("UPDATE presentations SET user_id=$1 WHERE id=$2")
						.bind(owner)
						.bind(id)
						.execute(&database)
						.await
						.unwrap();
				}
				self.values.lock().unwrap().get(key).cloned()
			})
		}
		fn set<'a>(&'a self, key: &'a str, value: &'a [u8], ttl: Duration) -> CacheFuture<'a, ()> {
			Box::pin(async move {
				assert_eq!(ttl, Duration::from_secs(3600));
				self.fills.fetch_add(1, Ordering::SeqCst);
				self.values
					.lock()
					.unwrap()
					.insert(key.to_owned(), value.to_vec());
			})
		}
	}

	async fn commit(
		database: &PgPool,
		id: &str,
		user: &str,
		number: i32,
		title: &str,
		asset: &str,
	) {
		let document = json!({"schemaVersion":3,"cardOrder":["c_aaaaaaaa"],"title":title,"cards":{"c_aaaaaaaa":{"nodes":[{"type":"image","assetId":asset}]}}}).to_string();
		let mut transaction = database.begin().await.unwrap();
		sqlx::query("INSERT INTO card_revisions(presentation_id,revision,sha256,byte_size,card_count,schema_version,author_id,operation_kind,operation_id,base_revision,document) VALUES($1,$2,$3,$4,1,3,$5,'generation',$6,$7,$8::jsonb)")
			.bind(id).bind(number).bind(hex::encode(Sha256::digest(document.as_bytes()))).bind(document.len() as i64).bind(user).bind(format!("operation-{number}")).bind((number>1).then_some(number-1)).bind(document)
			.execute(&mut *transaction).await.unwrap();
		sqlx::query("UPDATE presentations SET current_card_revision=$1 WHERE id=$2")
			.bind(number)
			.bind(id)
			.execute(&mut *transaction)
			.await
			.unwrap();
		transaction.commit().await.unwrap();
	}

	#[tokio::test]
	async fn cached_bodies_keep_heads_ownership_assets_and_miss_authorization_fresh() {
		let url = std::env::var("TEST_DATABASE_URL")
			.expect("TEST_DATABASE_URL is required with postgres-tests");
		let database = PgPool::connect(&url).await.unwrap();
		let user = format!("rust-document-{}", uuid::Uuid::new_v4());
		let other = format!("{user}-other");
		let id = format!("{user}-deck");
		sqlx::query("INSERT INTO users(id,name,email) VALUES($1,'Cards',$1 || '@test.invalid'),($2,'Other',$2 || '@test.invalid')").bind(&user).bind(&other).execute(&database).await.unwrap();
		sqlx::query("INSERT INTO presentations(id,user_id,title,prompt,slides_data) VALUES($1,$2,'Cards','Prompt','{}')").bind(&id).bind(&user).execute(&database).await.unwrap();
		let cache = Arc::new(BodyCache::default());
		let app = app(database.clone(), Some(cache.clone()));
		read(&app, &id, Some(&user), StatusCode::CONFLICT).await;
		let asset = "a".repeat(64);
		sqlx::query("INSERT INTO card_assets(presentation_id,sha256,mime_type,width,height,source,remote_url) VALUES($1,$2,'image/jpeg',640,360,'{\"type\":\"stock\"}','https://images.unsplash.com/old')").bind(&id).bind(&asset).execute(&database).await.unwrap();
		commit(&database, &id, &user, 1, "First", &asset).await;
		let first = read(&app, &id, Some(&user), StatusCode::OK).await;
		assert_eq!(first["document"]["title"], "First");
		assert_eq!(cache.fills.load(Ordering::SeqCst), 1);
		assert_eq!(read(&app, &id, Some(&user), StatusCode::OK).await, first);
		assert_eq!(cache.fills.load(Ordering::SeqCst), 1);
		let gets = cache.gets.load(Ordering::SeqCst);
		read(&app, &id, Some(&other), StatusCode::NOT_FOUND).await;
		assert_eq!(
			cache.gets.load(Ordering::SeqCst),
			gets,
			"ownership failure consulted cache"
		);
		sqlx::query("UPDATE card_assets SET remote_url='https://images.unsplash.com/new',source='{\"type\":\"stock\",\"photographer\":\"Fresh\"}' WHERE presentation_id=$1").bind(&id).execute(&database).await.unwrap();
		let fresh = read(&app, &id, Some(&user), StatusCode::OK).await;
		assert_eq!(
			fresh["assets"][&asset]["url"],
			"https://images.unsplash.com/new"
		);
		assert_eq!(fresh["assets"][&asset]["source"]["photographer"], "Fresh");
		assert_eq!(cache.fills.load(Ordering::SeqCst), 1);
		commit(&database, &id, &user, 2, "Second", &asset).await;
		let second = read(&app, &id, Some(&user), StatusCode::OK).await;
		assert_eq!(second["document"]["title"], "Second");
		assert_eq!(second["revision"]["baseRevision"], 1);
		assert_eq!(cache.fills.load(Ordering::SeqCst), 2);
		let mut transaction = database.begin().await.unwrap();
		sqlx::query("UPDATE presentations SET current_card_revision=1 WHERE id=$1")
			.bind(&id)
			.execute(&mut *transaction)
			.await
			.unwrap();
		transaction.rollback().await.unwrap();
		assert_eq!(read(&app, &id, Some(&user), StatusCode::OK).await, second);
		assert_eq!(cache.fills.load(Ordering::SeqCst), 2);
		for value in cache.values.lock().unwrap().values_mut() {
			*value = b"broken JSON".to_vec();
		}
		assert_eq!(read(&app, &id, Some(&user), StatusCode::OK).await, second);
		assert_eq!(cache.fills.load(Ordering::SeqCst), 3);
		cache.values.lock().unwrap().clear();
		*cache.transfer_on_get.lock().unwrap() =
			Some((database.clone(), id.clone(), other.clone()));
		read(&app, &id, Some(&user), StatusCode::NOT_FOUND).await;
		assert_eq!(
			cache.fills.load(Ordering::SeqCst),
			3,
			"cache miss did not repeat ownership check"
		);
		assert_eq!(
			read(&app, &id, Some(&other), StatusCode::OK).await["document"]["title"],
			"Second"
		);
		sqlx::query("DELETE FROM presentations WHERE id=$1")
			.bind(&id)
			.execute(&database)
			.await
			.unwrap();
		let gets = cache.gets.load(Ordering::SeqCst);
		read(&app, &id, Some(&other), StatusCode::NOT_FOUND).await;
		assert_eq!(
			cache.gets.load(Ordering::SeqCst),
			gets,
			"deleted presentation consulted cache"
		);
		sqlx::query("DELETE FROM users WHERE id IN ($1,$2)")
			.bind(&user)
			.bind(&other)
			.execute(&database)
			.await
			.unwrap();
		sqlx::query("DELETE FROM presentation_cache_versions WHERE user_id IN ($1,$2)")
			.bind(&user)
			.bind(&other)
			.execute(&database)
			.await
			.unwrap();
		database.close().await;
	}
}
