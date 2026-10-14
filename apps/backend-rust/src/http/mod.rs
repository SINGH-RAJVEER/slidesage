mod security;

use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::get};
use chrono::Utc;
use serde_json::json;

pub use security::Security;

/// Development-only partial router. Other application routes have not been ported.
pub fn router(security: Security) -> Router {
	security.apply(routes())
}

fn routes() -> Router {
	Router::new()
		.route("/health", get(health))
		.fallback(not_found)
		.method_not_allowed_fallback(not_found)
}

async fn health() -> impl IntoResponse {
	Json(json!({"status": "ok", "timestamp": crate::rfc3339_nano(Utc::now())}))
}

async fn not_found() -> impl IntoResponse {
	error(StatusCode::NOT_FOUND, "Resource not found")
}

pub(super) fn error(status: StatusCode, message: &str) -> axum::response::Response {
	// Go's json.Encoder adds a newline for JSON errors.
	let body = format!("{}\n", json!({"error": {"message": message}}));
	(status, [("content-type", "application/json")], body).into_response()
}
