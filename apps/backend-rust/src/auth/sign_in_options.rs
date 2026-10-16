//! Password availability for the sign-in form, including existing request protection.

use axum::{
	Router,
	extract::{Request, State},
	http::StatusCode,
	middleware,
	response::Response,
	routing::post,
};
use serde_json::json;

use super::{http::response, sign_in};
use crate::http::ApiState;

pub(super) fn routes(state: ApiState) -> Router<ApiState> {
	Router::new()
		.route("/auth/sign-in/options", post(options))
		.route_layer(middleware::from_fn_with_state(state, sign_in::protect))
}

async fn options(State(state): State<ApiState>, request: Request) -> Response {
	let input: sign_in::EmailInput<true> =
		match crate::http::json::decode(request.into_body(), 32 * 1024).await {
			Ok(input) => input,
			Err(crate::http::json::ReadError::TooLarge) => {
				return crate::http::error(
					StatusCode::PAYLOAD_TOO_LARGE,
					"Request body is too large",
				);
			}
			Err(_) => return crate::http::error(StatusCode::BAD_REQUEST, "Invalid request body"),
		};
	let email = sign_in::normalize_email(&input.email);
	if email.is_empty() {
		return crate::http::error(StatusCode::BAD_REQUEST, "enter a valid email address");
	}
	let user = match sign_in::user_by_email(&state, &email).await {
		Ok(Some(user)) => user,
		Ok(None) => {
			let mut result = response(
				json!({"code": "ACCOUNT_NOT_FOUND", "message": "No account exists for this email address. Create an account to continue."}),
			);
			*result.status_mut() = StatusCode::NOT_FOUND;
			return result;
		}
		Err(error) => return database_error(error),
	};
	match sqlx::query!(
		"SELECT password FROM accounts WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL ORDER BY created_at DESC LIMIT 1", user.id
	).fetch_optional(&state.database).await {
		Ok(row) => response(json!({"hasPassword": row.and_then(|row| row.password).is_some_and(|hash| super::password::is_password_hash(&hash))})),
		Err(error) => database_error(error),
	}
}

fn database_error(error: sqlx::Error) -> Response {
	// writeServiceError currently exposes pgx errors. Preserve its public shape
	// and formatting while SQLx remains the underlying driver.
	let message = if let Some(error) = error
		.as_database_error()
		.and_then(|error| error.try_downcast_ref::<sqlx::postgres::PgDatabaseError>())
	{
		format!(
			"{}: {} (SQLSTATE {})",
			format!("{:?}", error.severity()).to_ascii_uppercase(),
			error.message(),
			error.code()
		)
	} else if matches!(error, sqlx::Error::PoolClosed) {
		"sql: database is closed".to_owned()
	} else {
		error.to_string()
	};
	crate::http::error(StatusCode::BAD_REQUEST, message.trim())
}
