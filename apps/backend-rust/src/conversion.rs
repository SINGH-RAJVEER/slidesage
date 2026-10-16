use axum::{
	Json, Router,
	http::{Method, StatusCode},
	response::{IntoResponse, Response},
	routing::any,
};
use serde_json::json;

pub use crate::cards::SCHEMA_VERSION as CARD_SCHEMA_VERSION;

/// Health and schema metadata are implemented. Conversion and PPTX writing are pending.
pub fn router() -> Router {
	Router::new()
		.route("/health", any(health))
		.route("/v1/schema", any(schema))
		.fallback(not_found)
}

async fn health(method: Method) -> Response {
	if method != Method::GET {
		return not_found().await;
	}
	json_response(
		StatusCode::OK,
		json!({"status": "ok", "schemaVersion": CARD_SCHEMA_VERSION}),
	)
}

async fn schema(method: Method) -> Response {
	if method != Method::GET {
		return not_found().await;
	}
	json_response(StatusCode::OK, crate::cards::drafting_schema())
}

async fn not_found() -> Response {
	json_response(StatusCode::NOT_FOUND, json!({"error": "not found"}))
}

fn json_response(status: StatusCode, value: impl serde::Serialize) -> Response {
	(
		status,
		[("content-type", "application/json;charset=utf-8")],
		Json(value),
	)
		.into_response()
}
