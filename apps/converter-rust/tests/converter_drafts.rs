use axum::{
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;

async fn extract(body: String) -> (StatusCode, String) {
	let response = slidesage_converter::router()
		.oneshot(
			Request::post("/v1/documents/drafts")
				.header("X-Card-Schema-Version", "3")
				.body(Body::from(body))
				.unwrap(),
		)
		.await
		.unwrap();
	let status = response.status();
	assert_eq!(
		response.headers()["content-type"],
		"application/json;charset=utf-8"
	);
	let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
	(status, String::from_utf8(body.to_vec()).unwrap())
}

#[tokio::test]
async fn preserves_utf16_marks_notes_and_deduplicated_sources() {
	let (status, body) = extract(r#"{"document":{"schemaVersion":1,"title":"Title","theme":"paper","cardOrder":["c_first001"],"cards":{"c_first001":{"id":"c_first001","takeaway":"A point","layout":"title","role":"opening","sourceIds":["s1","s1"],"notes":"Notes \udfff","nodes":[{"id":"n_heading1","type":"heading","text":[{"text":"Both","bold":true,"italic":true},{"text":"\ud800"}]}]}}}}"#.into()).await;
	assert_eq!(status, StatusCode::OK);
	assert!(body.contains(r#""text":"**Both**\ud800""#));
	assert!(body.contains(r#""notes":"Notes \udfff""#));
	assert!(body.contains(r#""sourceIds":["s1"]"#));
	assert!(!body.contains("n_heading1"));
}

#[tokio::test]
async fn drops_images_while_validating_their_asset_ownership() {
	let asset = "a".repeat(64);
	let document = json!({"schemaVersion":3,"title":"Photo","theme":"paper","cardOrder":["c_photo001"],"cards":{"c_photo001":{
		"id":"c_photo001","takeaway":"One photo","role":"opening","layout":"cover","sourceIds":[],"nodes":[
			{"id":"n_heading1","type":"heading","text":[{"text":"Heading"}]},
			{"id":"n_image001","type":"image","assetId":asset,"alt":"A photo","fit":"cover"}
		]
	}}});
	let (status, body) = extract(json!({"document":document,"assetIds":[asset]}).to_string()).await;
	assert_eq!(status, StatusCode::OK);
	let result: serde_json::Value = serde_json::from_str(&body).unwrap();
	assert_eq!(
		result["cards"]["c_photo001"]["nodes"],
		json!([{"type":"heading","text":"Heading"}])
	);
	let (status, _) = extract(json!({"document":document,"assetIds":[]}).to_string()).await;
	assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
