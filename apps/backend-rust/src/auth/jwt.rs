//! HS256 token behavior from internal/auth/jwt.go. Cookie/user lookup is not ported yet.

use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
struct Claims {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	email: Option<String>,
	#[serde(default)]
	sub: String,
	exp: i64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	iat: Option<i64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	nbf: Option<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum TokenError {
	#[error("invalid token")]
	Invalid,
	#[error("token missing subject")]
	MissingSubject,
}

pub fn issue_token(
	secret: &[u8],
	user_id: &str,
	email: &str,
	issued_at: i64,
	ttl_seconds: i64,
) -> Result<String, TokenError> {
	let exp = issued_at
		.checked_add(ttl_seconds)
		.ok_or(TokenError::Invalid)?;
	let claims = Claims {
		email: (!email.is_empty()).then(|| email.to_owned()),
		sub: user_id.to_owned(),
		exp,
		iat: Some(issued_at),
		nbf: None,
	};
	encode(
		&Header::new(Algorithm::HS256),
		&claims,
		&EncodingKey::from_secret(secret),
	)
	.map_err(|_| TokenError::Invalid)
}

pub fn verify_token(secret: &[u8], token: &str) -> Result<String, TokenError> {
	let mut validation = Validation::new(Algorithm::HS256);
	validation.leeway = 0;
	validation.validate_nbf = true;
	// The existing Go verifier does not require or check an audience.
	validation.validate_aud = false;
	let claims = decode::<Claims>(token, &DecodingKey::from_secret(secret), &validation)
		.map_err(|_| TokenError::Invalid)?
		.claims;
	// Go rejects a token at its exact expiry second, with no leeway.
	if claims.exp <= chrono::Utc::now().timestamp() {
		return Err(TokenError::Invalid);
	}
	if claims.sub.is_empty() {
		return Err(TokenError::MissingSubject);
	}
	Ok(claims.sub)
}
