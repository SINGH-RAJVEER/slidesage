use axum::{
	body::{Body, to_bytes},
	http::{Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn submit(body: impl Into<Body>, version: Option<&str>) -> (StatusCode, Value) {
	let mut request = Request::post("/v1/templates");
	if let Some(version) = version {
		request = request.header("X-Card-Schema-Version", version);
	}
	let response = slidesage_converter::router()
		.oneshot(request.body(body.into()).unwrap())
		.await
		.unwrap();
	assert_eq!(
		response.headers()["content-type"],
		"application/json;charset=utf-8"
	);
	let status = response.status();
	let body = to_bytes(response.into_body(), 2 * 1024 * 1024)
		.await
		.unwrap();
	(status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn serves_all_compiled_templates_and_rejects_unknown_ids() {
	for id in [
		"ocean-proposal",
		"grove-lesson",
		"orchid-portfolio",
		"sand-workshop",
		"cobalt-launch",
		"mono-briefing",
	] {
		let (status, body) = submit(json!({"templateId": id}).to_string(), Some("3")).await;
		assert_eq!(status, StatusCode::OK, "{id}");
		assert_eq!(body["document"]["cardOrder"].as_array().unwrap().len(), 5);
		assert_eq!(body["assets"].as_object().unwrap().len(), 1);
	}
	assert_eq!(
		submit(r#"{"templateId":"missing"}"#, Some("3")).await,
		(
			StatusCode::NOT_FOUND,
			json!({"error": "template not found"})
		)
	);
}

#[tokio::test]
async fn template_requests_match_json_parse_and_schema_negotiation() {
	assert_eq!(
		submit("not JSON", None).await,
		(
			StatusCode::CONFLICT,
			json!({"error": "schema version (missing) is not served; this converter serves 3"})
		)
	);
	for (body, error) in [
		("", "request body is not JSON"),
		("{}{}", "request body is not JSON"),
		("[]", "request body must be an object"),
		("null", "request body must be an object"),
		("1e999", "request body must be an object"),
		("{}", "templateId must be a non-empty string"),
		(
			r#"{"templateId":1e999}"#,
			"templateId must be a non-empty string",
		),
		(
			r#"{"templateId":"\ufeff"}"#,
			"templateId must be a non-empty string",
		),
	] {
		assert_eq!(
			submit(body, Some("3")).await,
			(StatusCode::BAD_REQUEST, json!({"error": error})),
			"{body}"
		);
	}
	for body in [
		r#"{"templateId":"grove-lesson","ignored":1e999}"#,
		r#"{"templateId":"missing","templateId":"grove-lesson"}"#,
		r#"{"templateId":"grove-lesson","\udfff":"\ud800"}"#,
		"\u{feff}{\"templateId\":\"grove-lesson\"}",
	] {
		assert_eq!(submit(body, Some("3")).await.0, StatusCode::OK, "{body}");
	}
	assert_eq!(
		submit(r#"{"templateId":"\u0085"}"#, Some("3")).await.0,
		StatusCode::NOT_FOUND
	);
}

#[tokio::test]
async fn template_body_limit_counts_utf16_units_and_checks_declared_bytes() {
	let prefix = r#"{"templateId":"grove-lesson","ignored":""#;
	let limit = 1024 * 1024;
	let body = format!("{prefix}{}\"}}", "界".repeat(limit - prefix.len() - 2));
	assert_eq!(submit(body, Some("3")).await.0, StatusCode::OK);
	let body = format!("{prefix}{}\"}}", "界".repeat(limit - prefix.len() - 1));
	assert_eq!(
		submit(body, Some("3")).await,
		(
			StatusCode::PAYLOAD_TOO_LARGE,
			json!({"error": "request body is too large"})
		)
	);
	let response = slidesage_converter::router()
		.oneshot(
			Request::post("/v1/templates")
				.header("X-Card-Schema-Version", "3")
				.header("Content-Length", limit + 1)
				.body(Body::from("{}"))
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn converter_matches_fetch_header_joining_and_url_path_normalization() {
	for path in [
		"/v1/./templates",
		"/discard/../v1/templates",
		"/v1/%2e/templates",
		"/discard/%2e%2E/v1/templates",
		"/v1\\templates",
	] {
		let response = slidesage_converter::router()
			.oneshot(
				Request::post(path)
					.header("X-Card-Schema-Version", "3")
					.body(Body::from(r#"{"templateId":"grove-lesson"}"#))
					.unwrap(),
			)
			.await
			.unwrap();
		assert_eq!(response.status(), StatusCode::OK, "{path}");
	}
	let response = slidesage_converter::router()
		.oneshot(
			Request::post("/v1/templates")
				.header("X-Card-Schema-Version", "3")
				.header("X-Card-Schema-Version", "1")
				.body(Body::empty())
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::CONFLICT);
	let body: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
	assert_eq!(
		body,
		json!({"error": "schema version 3, 1 is not served; this converter serves 3"})
	);
}
