//! Owner-only creation, inspection, rotation and revocation of read-only links.

use axum::{
	Router,
	extract::{Path, State, rejection::PathRejection},
	http::{HeaderMap, StatusCode},
	response::{IntoResponse, Response},
	routing::get,
};
use chrono::{DateTime, Utc};
use rand::TryRngCore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::http::ApiState;

pub fn router(state: ApiState) -> Router {
	Router::new()
		.route(
			"/presentations/{id}/share",
			get(current).post(create).delete(revoke),
		)
		.with_state(state)
}

async fn owned(
	state: &ApiState,
	path: Result<Path<String>, PathRejection>,
	headers: &HeaderMap,
) -> Result<(String, String), Box<Response>> {
	let Some(user) = state.auth.user_id(headers) else {
		return Err(Box::new(error(
			StatusCode::UNAUTHORIZED,
			"Authentication required",
		)));
	};
	// Go authenticates before passing the decoded path to PostgreSQL. An invalid
	// UTF-8 identifier fails that query, rather than becoming an extractor 400.
	let Path(id) = path.map_err(|error| {
		eprintln!("load share presentation owner: {error}");
		Box::new(error_response())
	})?;
	let exists = sqlx::query_scalar!(
		"SELECT EXISTS (SELECT 1 FROM presentations WHERE id = $1 AND user_id = $2) AS \"exists!\"",
		id,
		user
	)
	.fetch_one(&state.database)
	.await
	.map_err(|error| Box::new(failure(error)))?;
	if !exists {
		return Err(Box::new(error(
			StatusCode::NOT_FOUND,
			"Presentation not found",
		)));
	}
	Ok((id, user))
}

async fn current(
	State(state): State<ApiState>,
	path: Result<Path<String>, PathRejection>,
	headers: HeaderMap,
) -> Response {
	let (id, _) = match owned(&state, path, &headers).await {
		Ok(owner) => owner,
		Err(response) => return *response,
	};
	match sqlx::query_scalar!(
		"SELECT created_at FROM presentation_shares WHERE presentation_id = $1 AND revoked_at IS NULL",
		id
	)
	.fetch_optional(&state.database)
	.await
	{
		Ok(Some(created_at)) => response(
			StatusCode::OK,
			json!({"share": {"createdAt": timestamp(created_at)}}),
		),
		Ok(None) => response(StatusCode::OK, json!({"share": null})),
		Err(error) => failure(error),
	}
}

async fn create(
	State(state): State<ApiState>,
	path: Result<Path<String>, PathRejection>,
	headers: HeaderMap,
) -> Response {
	let (id, user) = match owned(&state, path, &headers).await {
		Ok(owner) => owner,
		Err(response) => return *response,
	};
	let token = match new_token() {
		Ok(token) => token,
		Err(error) => {
			eprintln!("create share token: {error}");
			return error_response();
		}
	};
	let share_id = uuid::Uuid::new_v4().to_string();
	let digest = hex::encode(Sha256::digest(token.as_bytes()));
	match create_in_transaction(&state.database, &id, &user, &share_id, &digest).await {
		Ok(created_at) => response(
			StatusCode::CREATED,
			json!({"share": {"createdAt": timestamp(created_at), "token": token}}),
		),
		Err(error) => failure(error),
	}
}

async fn create_in_transaction(
	database: &sqlx::PgPool,
	id: &str,
	user: &str,
	share_id: &str,
	digest: &str,
) -> Result<DateTime<Utc>, sqlx::Error> {
	let mut transaction = database.begin().await?;
	sqlx::query!("UPDATE presentation_shares SET revoked_at = NOW() WHERE presentation_id = $1 AND revoked_at IS NULL", id)
		.execute(&mut *transaction).await?;
	let created_at = sqlx::query_scalar!("INSERT INTO presentation_shares (id, presentation_id, token_sha256, created_by) VALUES ($1::text::uuid, $2, $3, $4) RETURNING created_at", share_id, id, digest, user)
		.fetch_one(&mut *transaction).await?;
	transaction.commit().await?;
	Ok(created_at)
}

async fn revoke(
	State(state): State<ApiState>,
	path: Result<Path<String>, PathRejection>,
	headers: HeaderMap,
) -> Response {
	let (id, _) = match owned(&state, path, &headers).await {
		Ok(owner) => owner,
		Err(response) => return *response,
	};
	match sqlx::query!("UPDATE presentation_shares SET revoked_at = NOW() WHERE presentation_id = $1 AND revoked_at IS NULL", id)
		.execute(&state.database).await {
		// Go writes only the status: a successful DELETE has no JSON/cache headers.
		Ok(_) => StatusCode::NO_CONTENT.into_response(),
		Err(error) => failure(error),
	}
}

fn new_token() -> Result<String, rand::rand_core::OsError> {
	let mut bytes = [0u8; 32];
	rand::rngs::OsRng.try_fill_bytes(&mut bytes)?;
	// Unpadded base64url is exactly 43 bytes for a 256-bit random token.
	const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	let mut token = String::with_capacity(43);
	for block in bytes.chunks(3) {
		let bits = (u32::from(block[0]) << 16)
			| (u32::from(*block.get(1).unwrap_or(&0)) << 8)
			| u32::from(*block.get(2).unwrap_or(&0));
		for index in 0..block.len() + 1 {
			token.push(ALPHABET[((bits >> (18 - index * 6)) & 63) as usize] as char);
		}
	}
	Ok(token)
}

fn timestamp(time: DateTime<Utc>) -> String {
	crate::card_documents::revision_timestamp(time)
}

fn failure(error: sqlx::Error) -> Response {
	eprintln!("manage presentation share: {error}");
	error_response()
}

fn error_response() -> Response {
	error(
		StatusCode::INTERNAL_SERVER_ERROR,
		"Unable to load the presentation",
	)
}

fn error(status: StatusCode, message: &str) -> Response {
	response(status, json!({"error": {"message": message}}))
}

fn response(status: StatusCode, value: Value) -> Response {
	(
		status,
		[
			("content-type", "application/json"),
			("cache-control", "private, no-store"),
		],
		format!("{value}\n"),
	)
		.into_response()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn tokens_use_unpadded_url_encoding_and_do_not_repeat() {
		let mut tokens = std::collections::HashSet::new();
		for _ in 0..256 {
			let token = new_token().unwrap();
			assert_eq!(token.len(), 43);
			assert!(
				token
					.bytes()
					.all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
			);
			// Two remaining input bytes occupy four bits in the final sextet.
			assert!(b"AEIMQUYcgkosw048".contains(token.as_bytes().last().unwrap()));
			assert!(tokens.insert(token));
		}
	}

	#[test]
	fn timestamp_retains_local_offset_without_fractional_zeroes() {
		for text in ["2026-01-02T03:04:05Z", "2026-01-02T03:04:05.123400Z"] {
			let time = DateTime::parse_from_rfc3339(text)
				.unwrap()
				.with_timezone(&Utc);
			let formatted = timestamp(time);
			assert_eq!(DateTime::parse_from_rfc3339(&formatted).unwrap(), time);
			assert!(!formatted.contains("123400"));
		}
	}
}
