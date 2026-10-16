//! Password sign-in and the existing PostgreSQL IP/email request protection.

use std::{
	fmt,
	net::SocketAddr,
	sync::{Arc, OnceLock},
};

use axum::{
	Router,
	body::Body,
	extract::{ConnectInfo, Request, State},
	http::StatusCode,
	middleware::{self, Next},
	response::{IntoResponse, Response},
	routing::post,
};
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use serde::{
	Deserialize, Deserializer,
	de::{self, IgnoredAny, MapAccess, Visitor},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use super::http::{User, response};
use crate::http::ApiState;

const BODY_LIMIT: usize = 32 * 1024;
const SESSION_SECONDS: i64 = 7 * 24 * 3600;

pub(super) fn routes(state: ApiState) -> Router<ApiState> {
	Router::new()
		.route("/auth/sign-in/email", post(sign_in))
		.route_layer(middleware::from_fn_with_state(state, protect))
}

async fn sign_in(State(state): State<ApiState>, request: Request) -> Response {
	let input: SignInInput = match crate::http::json::decode(request.into_body(), BODY_LIMIT).await
	{
		Ok(input) => input,
		Err(crate::http::json::ReadError::TooLarge) => {
			return crate::http::error(StatusCode::PAYLOAD_TOO_LARGE, "Request body is too large");
		}
		Err(_) => return crate::http::error(StatusCode::BAD_REQUEST, "Invalid request body"),
	};
	let email = normalize_email(&input.email);
	let user = match user_by_email(&state, &email).await {
		Ok(Some(user)) => user,
		_ => return credentials_error(),
	};
	let hash = match sqlx::query!(
		"SELECT password FROM accounts WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL ORDER BY created_at DESC LIMIT 1", user.id
	).fetch_optional(&state.database).await {
		Ok(Some(row)) => row.password.unwrap_or_default(),
		_ => return credentials_error(),
	};
	// Keep expensive scrypt off Tokio's executor, with at most two concurrent
	// derivations. The permit lives in the task even if the HTTP request is cancelled.
	static PASSWORD_WORKERS: OnceLock<Arc<Semaphore>> = OnceLock::new();
	let permit = PASSWORD_WORKERS
		.get_or_init(|| Arc::new(Semaphore::new(2)))
		.clone()
		.acquire_owned()
		.await
		.expect("password semaphore stays open");
	let verified = tokio::task::spawn_blocking(move || {
		let _permit = permit;
		super::password::verify_password(&hash, &input.password)
	})
	.await
	.unwrap_or(false);
	if !verified {
		return credentials_error();
	}
	if !user.email_verified {
		return with_status(
			StatusCode::UNAUTHORIZED,
			json!({"message": "email address is not verified", "code": "EMAIL_NOT_VERIFIED"}),
		);
	}
	// issueJWT re-reads the user before minting a token in the reference service.
	let current_email = match sqlx::query!("SELECT email FROM users WHERE id = $1", user.id)
		.fetch_optional(&state.database)
		.await
	{
		Ok(Some(row)) => row.email,
		_ => return crate::http::error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to sign in"),
	};
	let now = Utc::now();
	let Some(token) = state
		.auth
		.sign_in_token(&user.id, &current_email, now.timestamp())
	else {
		return crate::http::error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to sign in");
	};
	let cookie = state.auth.sign_in_cookie(
		&token,
		input.remember_me.unwrap_or(true),
		now + chrono::Duration::seconds(SESSION_SECONDS),
	);
	(
		[("set-cookie", cookie)],
		response(json!({"redirect": false, "token": token, "url": null, "user": user})),
	)
		.into_response()
}

pub(super) async fn user_by_email(
	state: &ApiState,
	email: &str,
) -> Result<Option<User>, sqlx::Error> {
	let row = sqlx::query!(
		"SELECT id, name, email, email_verified, image, balance_millis::double precision / 1000 AS \"slide_tokens!\", landing_page, created_at, updated_at FROM users WHERE email = $1", email
	).fetch_optional(&state.database).await?;
	Ok(row.map(|row| User {
		id: row.id,
		name: row.name,
		email: row.email,
		email_verified: row.email_verified,
		image: row.image,
		slide_tokens: row.slide_tokens,
		landing_page: row.landing_page,
		created_at: crate::rfc3339_nano(row.created_at.and_utc()),
		updated_at: crate::rfc3339_nano(row.updated_at.and_utc()),
	}))
}

pub(super) fn normalize_email(email: &str) -> String {
	// Go strings.ToLower uses Unicode simple case mappings. U+0130 is the only
	// expanding Rust lowercase mapping and must become a plain i here.
	let email: String = email
		.trim()
		.chars()
		.flat_map(|ch| {
			if ch == '\u{130}' {
				'i'.to_lowercase()
			} else {
				ch.to_lowercase()
			}
		})
		.collect();
	if email.len() < 3 || email.len() > 255 {
		return String::new();
	}
	let Some((local, domain)) = email.split_once('@') else {
		return String::new();
	};
	if local.is_empty()
		|| domain.contains('@')
		|| email
			.bytes()
			.any(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0c))
	{
		return String::new();
	}
	if !domain
		.bytes()
		.enumerate()
		.any(|(index, byte)| byte == b'.' && index > 0 && index + 1 < domain.len())
	{
		return String::new();
	}
	email
}

fn credentials_error() -> Response {
	with_status(
		StatusCode::UNAUTHORIZED,
		json!({"message": "invalid email or password", "code": "INVALID_EMAIL_OR_PASSWORD"}),
	)
}

fn with_status(status: StatusCode, value: serde_json::Value) -> Response {
	let mut result = response(value);
	*result.status_mut() = status;
	result
}

/// Go peeks at most 32KiB + 1 for the email counter and replaces the request
/// body with those bytes, even when the original stream was longer.
pub(super) async fn protect(
	State(state): State<ApiState>,
	mut request: Request,
	next: Next,
) -> Response {
	let address = client_address(&request);
	let now = Utc::now();
	let mut bytes = Vec::new();
	let mut body = std::mem::replace(request.body_mut(), Body::empty());
	let mut read_failed = false;
	while bytes.len() <= BODY_LIMIT {
		match body.frame().await {
			None => break,
			Some(Err(_)) => {
				read_failed = true;
				break;
			}
			Some(Ok(frame)) => {
				if let Ok(data) = frame.into_data() {
					let remaining = BODY_LIMIT + 1 - bytes.len();
					bytes.extend_from_slice(&data[..data.len().min(remaining)]);
				}
			}
		}
	}
	let email = if !read_failed && bytes.len() <= BODY_LIMIT {
		crate::http::json::decode::<EmailInput>(Body::from(bytes.clone()), BODY_LIMIT)
			.await
			.ok()
			.map(|input| simple_lowercase(input.email.trim()))
			.unwrap_or_default()
	} else {
		String::new()
	};
	*request.body_mut() = if read_failed {
		Body::empty()
	} else {
		Body::from(bytes)
	};
	let start = DateTime::from_timestamp(now.timestamp().div_euclid(900) * 900, 0).unwrap();
	let expiry = start + chrono::Duration::minutes(15);
	for (scope, key, limit) in [
		("auth-sign-in-ip", address, 30),
		("auth-sign-in-email", email.into_bytes(), 10),
	] {
		if scope.ends_with("-email") && key.is_empty() {
			continue;
		}
		let mut digest = Sha256::new();
		digest.update(state.rate_limit_secret.as_bytes());
		digest.update(b"\0");
		digest.update(scope.as_bytes());
		digest.update(b"\0");
		digest.update(&key);
		let key_hash = hex::encode(digest.finalize());
		let count = sqlx::query!(
			"INSERT INTO api_rate_limits (scope, key_hash, window_start, request_count, expires_at) VALUES ($1, $2, $3, 1, $4) ON CONFLICT (scope, key_hash, window_start) DO UPDATE SET request_count = api_rate_limits.request_count + 1, expires_at = EXCLUDED.expires_at RETURNING request_count", scope, key_hash, start, expiry
		).fetch_one(&state.database).await;
		let record = match count {
			Ok(record) => record,
			Err(_) => {
				return rate_response(
					StatusCode::SERVICE_UNAVAILABLE,
					json!({"error": {"message": "Request protection is temporarily unavailable", "code": "RATE_LIMIT_UNAVAILABLE"}}),
				);
			}
		};
		if record.request_count > limit {
			let remaining = (expiry - Utc::now()).num_nanoseconds().unwrap_or(0) as f64 / 1e9;
			let retry = ((remaining + 0.999) as i64).max(1);
			let mut response = rate_response(
				StatusCode::TOO_MANY_REQUESTS,
				json!({"error": {"message": "Too many requests", "code": "RATE_LIMITED"}, "retry_after": retry}),
			);
			response
				.headers_mut()
				.insert("retry-after", retry.to_string().parse().unwrap());
			return response;
		}
	}
	next.run(request).await
}

fn simple_lowercase(value: &str) -> String {
	value
		.chars()
		.flat_map(|ch| {
			if ch == '\u{130}' {
				'i'.to_lowercase()
			} else {
				ch.to_lowercase()
			}
		})
		.collect()
}

fn client_address(request: &Request) -> Vec<u8> {
	if std::env::var("TRUST_PROXY_HEADERS").as_deref() == Ok("true") {
		for name in ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"] {
			if let Some(value) = request.headers().get(name) {
				let value = if name == "x-forwarded-for" {
					value
						.as_bytes()
						.split(|byte| *byte == b',')
						.next()
						.unwrap_or(b"")
				} else {
					value.as_bytes()
				};
				let value = super::request::trim_go_space_bytes(value);
				if !value.is_empty() {
					// Go hashes the first 128 bytes, including a partial UTF-8 suffix.
					return value[..value.len().min(128)].to_vec();
				}
			}
		}
	}
	request
		.extensions()
		.get::<ConnectInfo<SocketAddr>>()
		.map(|peer| peer.0.ip().to_string().into_bytes())
		.unwrap_or_default()
}

fn rate_response(status: StatusCode, value: serde_json::Value) -> Response {
	(
		status,
		[("content-type", "application/json; charset=utf-8")],
		format!("{value}\n"),
	)
		.into_response()
}

#[derive(Default)]
struct SignInInput {
	email: String,
	password: String,
	remember_me: Option<bool>,
}

#[derive(Default)]
pub(super) struct EmailInput<const STRICT: bool = false> {
	pub(super) email: String,
}

fn folded(value: &str) -> String {
	value
		.chars()
		.map(|ch| {
			if ch == '\u{17f}' {
				'S'
			} else if ch == '\u{212a}' {
				'K'
			} else {
				ch.to_ascii_uppercase()
			}
		})
		.collect()
}

impl<'de> Deserialize<'de> for SignInInput {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		struct InputVisitor;
		impl<'de> Visitor<'de> for InputVisitor {
			type Value = SignInInput;
			fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
				f.write_str("a sign-in object or null")
			}
			fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
				Ok(SignInInput::default())
			}
			fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
				let mut input = SignInInput::default();
				while let Some(key) = map.next_key::<String>()? {
					match folded(&key).as_str() {
						"EMAIL" => {
							if let Some(value) = map.next_value::<Option<String>>()? {
								input.email = value;
							}
						}
						"PASSWORD" => {
							if let Some(value) = map.next_value::<Option<String>>()? {
								input.password = value;
							}
						}
						"REMEMBERME" => input.remember_me = map.next_value()?,
						_ => return Err(de::Error::custom("unknown field")),
					}
				}
				Ok(input)
			}
		}
		deserializer.deserialize_any(InputVisitor)
	}
}

impl<'de, const STRICT: bool> Deserialize<'de> for EmailInput<STRICT> {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		struct EmailVisitor<const STRICT: bool>;
		impl<'de, const STRICT: bool> Visitor<'de> for EmailVisitor<STRICT> {
			type Value = EmailInput<STRICT>;
			fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
				f.write_str("an object or null")
			}
			fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
				Ok(EmailInput::<STRICT>::default())
			}
			fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
				let mut input = EmailInput::<STRICT>::default();
				while let Some(key) = map.next_key::<String>()? {
					if folded(&key) == "EMAIL" {
						if let Some(value) = map.next_value::<Option<String>>()? {
							input.email = value;
						}
					} else if STRICT {
						return Err(de::Error::custom("unknown field"));
					} else {
						map.next_value::<IgnoredAny>()?;
					}
				}
				Ok(input)
			}
		}
		deserializer.deserialize_any(EmailVisitor::<STRICT>)
	}
}
