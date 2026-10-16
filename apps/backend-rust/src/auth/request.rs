//! Token selection and the fast JWT identity path from auth/http.go.

use axum::http::{HeaderMap, header};

#[derive(Clone)]
pub struct RequestAuth {
	secret: Vec<u8>,
	cookie_name: String,
	secure_cookies: bool,
}

impl RequestAuth {
	pub fn new(secret: &[u8], cookie_name: &str) -> Self {
		Self {
			secret: secret.to_vec(),
			cookie_name: cookie_name.to_owned(),
			secure_cookies: false,
		}
	}

	pub fn user_id(&self, headers: &HeaderMap) -> Option<String> {
		let (_, user_id) = self.session(headers)?;
		(!user_id.trim().is_empty()).then_some(user_id)
	}

	/// Match the API startup policy: HTTPS uses Secure and SameSite=None.
	pub fn with_secure_cookies(mut self, secure: bool) -> Self {
		self.secure_cookies = secure;
		self
	}

	pub(super) fn session<'a>(&self, headers: &'a HeaderMap) -> Option<(&'a str, String)> {
		let token = self.token(headers)?;
		Some((token, super::jwt::verify_token(&self.secret, token).ok()?))
	}

	pub(super) fn sign_out_cookie(&self) -> String {
		format!(
			"{}=; Path=/; Max-Age=0; HttpOnly; {}",
			self.cookie_name,
			if self.secure_cookies {
				"Secure; SameSite=None"
			} else {
				"SameSite=Lax"
			}
		)
	}

	fn token<'a>(&self, headers: &'a HeaderMap) -> Option<&'a str> {
		if let Some(value) = headers
			.get(header::AUTHORIZATION)
			.and_then(|value| value.to_str().ok())
			&& let Some(token) = value.strip_prefix("Bearer ")
		{
			return Some(token);
		}
		for line in headers.get_all(header::COOKIE) {
			let Ok(line) = line.to_str() else { continue };
			for part in line.split(';') {
				let Some((name, value)) = part.trim().split_once('=') else {
					continue;
				};
				if name.trim() != self.cookie_name {
					continue;
				}
				let value = value
					.strip_prefix('"')
					.and_then(|value| value.strip_suffix('"'))
					.unwrap_or(value);
				if value.bytes().all(|byte| {
					(0x20..0x7f).contains(&byte) && !matches!(byte, b'"' | b';' | b'\\')
				}) {
					return Some(value);
				}
			}
		}
		None
	}
}
