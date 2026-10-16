//! Read-only balance endpoint. Payment creation and fulfillment are still pending.

use axum::{
	Router,
	extract::State,
	http::{HeaderMap, StatusCode},
	response::{IntoResponse, Response},
	routing::get,
};
use serde_json::json;

use crate::http::ApiState;

pub fn router(state: ApiState) -> Router {
	Router::new()
		.route("/billing/balance", get(balance))
		.with_state(state)
}

async fn balance(State(state): State<ApiState>, headers: HeaderMap) -> Response {
	let Some(user_id) = state.auth.user_id(&headers) else {
		return error(StatusCode::UNAUTHORIZED, "Unauthorized");
	};
	match sqlx::query!("SELECT balance_millis FROM users WHERE id = $1", user_id)
		.fetch_one(&state.database)
		.await
	{
		Ok(row) => json_response(
			StatusCode::OK,
			json!({"slide_tokens": row.balance_millis as f64 / 1000.0}),
		),
		Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"),
	}
}

fn error(status: StatusCode, message: &str) -> Response {
	json_response(status, json!({"error": {"message": message}}))
}

fn json_response(status: StatusCode, value: serde_json::Value) -> Response {
	// Preserve the billing handler's charset and json.Encoder newline.
	(
		status,
		[("content-type", "application/json; charset=utf-8")],
		format!("{value}\n"),
	)
		.into_response()
}
