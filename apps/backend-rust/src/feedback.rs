//! POST /feedback port, with the existing SQL and HTTP validation behavior.

use axum::{
	Router,
	extract::{Request, State},
	http::StatusCode,
	middleware::{self, Next},
	response::{IntoResponse, Response},
	routing::post,
};
use chrono::{DateTime, Utc};
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::fmt;

use crate::http::ApiState;

const MAX_MESSAGE_LENGTH: usize = 4000;
const BODY_LIMIT: usize = 32 * 1024;

pub fn router(state: ApiState) -> Router {
	Router::new()
		.route("/feedback", post(submit))
		.route_layer(middleware::from_fn_with_state(state.clone(), protect))
		.with_state(state)
}

#[derive(Clone)]
struct FeedbackUser(String);

async fn protect(State(state): State<ApiState>, mut request: Request, next: Next) -> Response {
	let Some(user_id) = state.auth.user_id(request.headers()) else {
		return next.run(request).await;
	};
	let now = Utc::now();
	let start = DateTime::from_timestamp(now.timestamp().div_euclid(3600) * 3600, 0).unwrap();
	let expiry = start + chrono::Duration::hours(1);
	let key_hash = hex::encode(Sha256::digest(
		format!("{}\0feedback-submit\0{user_id}", state.rate_limit_secret).as_bytes(),
	));
	let record = sqlx::query!(
		"INSERT INTO api_rate_limits (scope, key_hash, window_start, request_count, expires_at) VALUES ($1, $2, $3, 1, $4) ON CONFLICT (scope, key_hash, window_start) DO UPDATE SET request_count = api_rate_limits.request_count + 1, expires_at = EXCLUDED.expires_at RETURNING request_count",
		"feedback-submit", key_hash, start, expiry
	).fetch_one(&state.database).await;
	match record {
		Err(_) => {
			return json_response(
				StatusCode::SERVICE_UNAVAILABLE,
				json!({"error": {
					"message": "Request protection is temporarily unavailable", "code": "RATE_LIMIT_UNAVAILABLE"
				}}),
			);
		}
		Ok(record) if record.request_count > 10 => {
			let remaining = (expiry - Utc::now()).num_nanoseconds().unwrap_or(0) as f64 / 1e9;
			let retry = ((remaining + 0.999) as i64).max(1);
			let mut response = json_response(
				StatusCode::TOO_MANY_REQUESTS,
				json!({"error": {
				"message": "Too many requests", "code": "RATE_LIMITED"
			}, "retry_after": retry}),
			);
			response
				.headers_mut()
				.insert("retry-after", retry.to_string().parse().unwrap());
			return response;
		}
		Ok(_) => {}
	}
	request.extensions_mut().insert(FeedbackUser(user_id));
	next.run(request).await
}

async fn submit(State(state): State<ApiState>, request: Request) -> Response {
	let Some(FeedbackUser(user_id)) = request.extensions().get::<FeedbackUser>().cloned() else {
		return error(StatusCode::UNAUTHORIZED, "Unauthorized");
	};
	let input: FeedbackInput =
		match crate::http::json::decode(request.into_body(), BODY_LIMIT).await {
			Ok(input) => input,
			Err(crate::http::json::ReadError::TooLarge) => {
				return error(StatusCode::PAYLOAD_TOO_LARGE, "Request body is too large");
			}
			Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid request body"),
		};
	let message = input.message.trim();
	if message.is_empty() {
		return error(StatusCode::BAD_REQUEST, "Feedback cannot be empty");
	}
	if message.chars().count() > MAX_MESSAGE_LENGTH {
		return error(
			StatusCode::BAD_REQUEST,
			"Feedback must be at most 4000 characters",
		);
	}
	match save(&state.database, &user_id, message).await {
		Ok((id, created_at)) => json_response(
			StatusCode::CREATED,
			json!({"feedback": {
				"id": id, "created_at": crate::rfc3339_nano(created_at)
			}}),
		),
		Err(err) => {
			eprintln!("feedback save failed: {err}");
			error(StatusCode::INTERNAL_SERVER_ERROR, "Could not save feedback")
		}
	}
}

async fn save(
	database: &PgPool,
	user_id: &str,
	message: &str,
) -> Result<(String, DateTime<Utc>), sqlx::Error> {
	let id = uuid::Uuid::new_v4().to_string();
	let record = sqlx::query!(
		"INSERT INTO feedback (id, user_id, message) VALUES ($1, $2, $3) RETURNING created_at",
		id,
		user_id,
		message
	)
	.fetch_one(database)
	.await?;
	Ok((id, record.created_at))
}

fn error(status: StatusCode, message: &str) -> Response {
	json_response(status, json!({"error": {"message": message}}))
}

fn json_response(status: StatusCode, body: serde_json::Value) -> Response {
	(
		status,
		[("content-type", "application/json; charset=utf-8")],
		format!("{body}\n"),
	)
		.into_response()
}

#[derive(Default)]
struct FeedbackInput {
	message: String,
}

impl<'de> Deserialize<'de> for FeedbackInput {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		struct InputVisitor;
		impl<'de> Visitor<'de> for InputVisitor {
			type Value = FeedbackInput;
			fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
				formatter.write_str("a feedback object or null")
			}
			fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
				Ok(FeedbackInput::default())
			}
			fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
				let mut input = FeedbackInput::default();
				while let Some(key) = map.next_key::<String>()? {
					// Go matches JSON struct fields case-insensitively, including long s.
					let folded: String = key
						.chars()
						.map(|ch| {
							if ch == '\u{17f}' {
								'S'
							} else {
								ch.to_ascii_uppercase()
							}
						})
						.collect();
					if folded != "MESSAGE" {
						return Err(de::Error::custom("unknown field"));
					}
					if let Some(message) = map.next_value::<Option<String>>()? {
						input.message = message;
					}
				}
				Ok(input)
			}
		}
		deserializer.deserialize_any(InputVisitor)
	}
}
