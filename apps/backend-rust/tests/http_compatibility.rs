//! HTTP behavior from cmd/api/main.go.

use axum::{
	Router,
	body::{Body, to_bytes},
	http::{Method, Request, StatusCode},
};
use serde_json::{Value, json};
use slidesage_backend::http::{Security, router};
use tower::ServiceExt;

fn api() -> Router {
	router(Security::new("https://slidesage.app"))
}

#[test]
fn timestamp_format_matches_go_rfc3339_nano() {
	for (nanos, expected) in [
		(0, "1970-01-01T00:00:00Z"),
		(123_400_000, "1970-01-01T00:00:00.1234Z"),
		(10, "1970-01-01T00:00:00.00000001Z"),
	] {
		assert_eq!(
			slidesage_backend::rfc3339_nano(chrono::DateTime::from_timestamp(0, nanos).unwrap()),
			expected
		);
	}
}

#[tokio::test]
async fn health_returns_ok_and_a_utc_timestamp() {
	let response = api()
		.oneshot(Request::get("/health").body(Body::empty()).unwrap())
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::OK);
	assert_eq!(response.headers()["content-type"], "application/json");
	let body: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
	assert_eq!(body["status"], "ok");
	let timestamp = body["timestamp"].as_str().unwrap();
	assert!(timestamp.ends_with('Z'));
	chrono::DateTime::parse_from_rfc3339(timestamp).unwrap();
}

#[tokio::test]
async fn security_rejects_unsafe_untrusted_origin() {
	// Same request/status assertion as TestSecurityRejectsUnsafeUntrustedOrigin.
	let response = api()
		.oneshot(
			Request::post("/profile")
				.header("Origin", "https://attacker.example")
				.body(Body::empty())
				.unwrap(),
		)
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::FORBIDDEN);
	let body: Value =
		serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
	assert_eq!(body, json!({"error": {"message": "Origin is not allowed"}}));
}

#[tokio::test]
async fn security_sets_credentialed_cors_headers() {
	// Same header assertions as TestSecuritySetsCredentialedCORSHeaders.
	let response = api()
		.oneshot(
			Request::get("/health")
				.header("Origin", "https://slidesage.app")
				.body(Body::empty())
				.unwrap(),
		)
		.await
		.unwrap();
	let headers = response.headers();
	assert_eq!(
		headers["access-control-allow-origin"],
		"https://slidesage.app"
	);
	assert_eq!(
		headers["access-control-allow-headers"],
		"Content-Type, Authorization, Idempotency-Key, Last-Event-ID"
	);
	assert_eq!(
		headers["access-control-expose-headers"],
		"X-Generation-Job-ID, X-Presentation-ID"
	);
	assert_eq!(headers["access-control-allow-credentials"], "true");
	assert_eq!(headers["vary"], "Origin");
}

#[tokio::test]
async fn preflight_and_cross_site_rules_match_the_existing_security_wrapper() {
	for (method, path, origin, fetch_site, expected) in [
		(
			Method::OPTIONS,
			"/missing",
			"https://slidesage.app",
			"",
			StatusCode::NO_CONTENT,
		),
		(
			Method::OPTIONS,
			"/missing",
			"https://attacker.example",
			"",
			StatusCode::FORBIDDEN,
		),
		(Method::OPTIONS, "/missing", "", "", StatusCode::NO_CONTENT),
		(
			Method::POST,
			"/profile",
			"",
			"cross-site",
			StatusCode::FORBIDDEN,
		),
		(
			Method::POST,
			"/billing/webhook",
			"https://attacker.example",
			"cross-site",
			StatusCode::NOT_FOUND,
		),
		(
			Method::GET,
			"/health",
			"https://attacker.example",
			"cross-site",
			StatusCode::OK,
		),
		(
			Method::POST,
			"/billing/%77ebhook",
			"https://attacker.example",
			"cross-site",
			StatusCode::NOT_FOUND,
		),
		(Method::POST, "/health", "", "", StatusCode::NOT_FOUND),
	] {
		let request = Request::builder()
			.method(method)
			.uri(path)
			.header("Origin", origin)
			.header("Sec-Fetch-Site", fetch_site)
			.body(Body::empty())
			.unwrap();
		assert_eq!(
			api().oneshot(request).await.unwrap().status(),
			expected,
			"{path}"
		);
	}
}

#[tokio::test]
async fn unknown_routes_return_the_existing_error_shape() {
	let response = api()
		.oneshot(Request::get("/missing").body(Body::empty()).unwrap())
		.await
		.unwrap();
	assert_eq!(response.status(), StatusCode::NOT_FOUND);
	assert_eq!(
		&to_bytes(response.into_body(), 4096).await.unwrap()[..],
		b"{\"error\":{\"message\":\"Resource not found\"}}\n"
	);
}
