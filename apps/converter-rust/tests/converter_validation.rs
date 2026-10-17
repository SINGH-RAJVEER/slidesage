use axum::{
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use tower::ServiceExt;

async fn validate(body: &str) -> (StatusCode, String) {
	let response = slidesage_converter::router()
		.oneshot(
			Request::post("/v1/documents/validate")
				.header("X-Card-Schema-Version", "3")
				.body(Body::from(body.to_owned()))
				.unwrap(),
		)
		.await
		.unwrap();
	let status = response.status();
	let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
	(status, String::from_utf8(bytes.to_vec()).unwrap())
}
#[tokio::test]
async fn normalizes_older_documents_without_losing_utf16_text() {
	let (status,body)=validate(r#"{"document":{"schemaVersion":1,"title":"Title","theme":"paper","cardOrder":["c_first001"],"cards":{"c_first001":{"id":"c_first001","takeaway":"One point","role":"opening","layout":"title","nodes":[{"id":"n_heading1","type":"heading","text":[{"text":"\ud800"}]}],"sourceIds":["s1","s1"]}}}}"#).await;
	assert_eq!(status, StatusCode::OK);
	assert!(body.contains(r#""schemaVersion":3"#));
	assert!(body.contains(r#""text":"\ud800""#));
	assert!(body.contains(r#""sourceIds":["s1"]"#));
}
#[tokio::test]
async fn issues_preserve_surrogate_paths_and_javascript_key_order() {
	let (status, body) = validate(r#"{"document":{"\ud800":1}}"#).await;
	assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
	assert!(body.contains(r#""path":"document.\ud800""#));
	let (status, body) = validate(r#"{"document":{"z":1,"10":1,"2":1}}"#).await;
	assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
	assert!(body.contains(r#""path":"document.2""#));
}
#[tokio::test]
async fn validates_asset_list_before_document_and_negotiates_before_body() {
	let (status, body) = validate(r#"{"assetIds":[null]}"#).await;
	assert_eq!(status, StatusCode::BAD_REQUEST);
	assert_eq!(
		body,
		r#"{"error":"assetIds[0] must be a non-empty string"}"#
	);
	let response = slidesage_converter::router()
		.oneshot(
			Request::post("/v1/documents/validate")
				.body(Body::from("not JSON"))
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn preserves_string_coercion_failure_priority() {
	let (status, body) = validate(
		r#"{"document":{"schemaVersion":3,"cardOrder":[{"toString":null}],"cards":null}}"#,
	)
	.await;
	assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
	assert_eq!(body, r#"{"error":"conversion failed"}"#);
}
