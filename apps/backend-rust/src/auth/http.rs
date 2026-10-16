//! Session/profile reads, sign-in route composition and stateless sign-out.

use axum::{
	Router,
	extract::State,
	http::{HeaderMap, StatusCode},
	response::{IntoResponse, Response},
	routing::{get, post},
};
use serde::Serialize;
use serde_json::json;

use crate::http::ApiState;

pub fn router(state: ApiState) -> Router {
	Router::new()
		.route("/auth/get-session", get(get_session))
		.route("/profile", get(profile))
		.route("/auth/sign-out", post(sign_out))
		.merge(super::sign_in::routes(state.clone()))
		.merge(super::sign_in_options::routes(state.clone()))
		.with_state(state)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct User {
	pub(super) id: String,
	pub(super) name: String,
	pub(super) email: String,
	pub(super) email_verified: bool,
	pub(super) image: Option<String>,
	pub(super) slide_tokens: f64,
	pub(super) landing_page: String,
	pub(super) created_at: String,
	pub(super) updated_at: String,
}

async fn authenticate(state: &ApiState, headers: &HeaderMap) -> Option<(String, User)> {
	let (token, user_id) = state.auth.session(headers)?;
	// Preserve the existing PostgreSQL floating-point conversion and user lookup.
	let row = sqlx::query!(
		"SELECT id, name, email, email_verified, image, balance_millis::double precision / 1000 AS \"slide_tokens!\", landing_page, created_at, updated_at FROM users WHERE id = $1",
		user_id
	).fetch_optional(&state.database).await.ok()??;
	Some((
		token.to_owned(),
		User {
			id: row.id,
			name: row.name,
			email: row.email,
			email_verified: row.email_verified,
			image: row.image,
			slide_tokens: row.slide_tokens,
			landing_page: row.landing_page,
			created_at: crate::rfc3339_nano(row.created_at.and_utc()),
			updated_at: crate::rfc3339_nano(row.updated_at.and_utc()),
		},
	))
}

async fn get_session(State(state): State<ApiState>, headers: HeaderMap) -> Response {
	let Some((token, user)) = authenticate(&state, &headers).await else {
		return response(json!(null));
	};
	// Go AuthenticateJWT reports lookup-time + 7 days, rather than the JWT's exp.
	let expires = crate::rfc3339_nano(chrono::Utc::now() + chrono::Duration::days(7));
	response(json!({"session": {
		"id": user.id, "token": token, "userId": user.id, "expiresAt": expires
	}, "user": user}))
}

async fn profile(State(state): State<ApiState>, headers: HeaderMap) -> Response {
	let Some((_, user)) = authenticate(&state, &headers).await else {
		return crate::http::error(StatusCode::UNAUTHORIZED, "Unauthorized");
	};
	let has_password = match sqlx::query!(
		"SELECT password FROM accounts WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL ORDER BY created_at DESC LIMIT 1",
		user.id
	).fetch_optional(&state.database).await {
		Ok(row) => row.and_then(|row| row.password).is_some_and(|hash| super::password::is_password_hash(&hash)),
		Err(_) => return crate::http::error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load profile"),
	};
	response(json!({"user": user, "hasPassword": has_password}))
}

async fn sign_out(State(state): State<ApiState>) -> Response {
	// The reference clears the browser cookie without revoking the bearer token.
	(
		[("set-cookie", state.auth.sign_out_cookie())],
		response(json!({"success": true})),
	)
		.into_response()
}

pub(super) fn response(value: serde_json::Value) -> Response {
	let text = value
		.to_string()
		.replace('&', "\\u0026")
		.replace('<', "\\u003c")
		.replace('>', "\\u003e")
		.replace('\u{2028}', "\\u2028")
		.replace('\u{2029}', "\\u2029");
	(
		StatusCode::OK,
		[("content-type", "application/json")],
		format!("{text}\n"),
	)
		.into_response()
}
