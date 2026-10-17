use axum::{
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

#[tokio::test]
async fn converter_health_reports_the_current_schema_version() {
	// Same expected JSON as handler.test.ts: reports health with its schema version.
	let response = slidesage_converter::router()
		.oneshot(Request::get("/health").body(Body::empty()).unwrap())
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::OK);
	let body: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
	assert_eq!(body, json!({"status": "ok", "schemaVersion": 3}));
	let response = slidesage_converter::router()
		.oneshot(Request::head("/health").body(Body::empty()).unwrap())
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
