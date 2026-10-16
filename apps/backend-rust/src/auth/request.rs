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

	pub(super) fn sign_in_token(&self, user_id: &str, email: &str, now: i64) -> Option<String> {
		super::jwt::issue_token(&self.secret, user_id, email, now, 7 * 24 * 3600).ok()
	}

	pub(super) fn sign_in_cookie(
		&self,
		token: &str,
		persistent: bool,
		expires: chrono::DateTime<chrono::Utc>,
	) -> String {
		format!(
			"{}={token}; Path=/; {}HttpOnly; {}",
			self.cookie_name,
			if persistent {
				format!("Expires={}; ", expires.format("%a, %d %b %Y %H:%M:%S GMT"))
			} else {
				String::new()
			},
			if self.secure_cookies {
				"Secure; SameSite=None"
			} else {
				"SameSite=Lax"
			}
		)
	}

	fn token<'a>(&self, headers: &'a HeaderMap) -> Option<&'a str> {
		if let Some(value) = headers.get(header::AUTHORIZATION)
			&& let Some(token) = value.as_bytes().strip_prefix(b"Bearer ")
		{
			// A malformed/non-ASCII bearer still blocks cookie authentication.
			return std::str::from_utf8(token).ok();
		}
		for line in headers.get_all(header::COOKIE) {
			// Go parses cookies separately even when another cookie contains
			// non-ASCII or invalid UTF-8 bytes in the same header line.
			for part in line.as_bytes().split(|byte| *byte == b';') {
				let part = trim_go_space_bytes(part);
				let Some(separator) = part.iter().position(|byte| *byte == b'=') else {
					continue;
				};
				let (name, value) = (&part[..separator], &part[separator + 1..]);
				if trim_go_space_bytes(name) != self.cookie_name.as_bytes() {
					continue;
				}
				let value = value
					.strip_prefix(b"\"")
					.and_then(|value| value.strip_suffix(b"\""))
					.unwrap_or(value);
				if value.iter().copied().all(|byte| {
					(0x20..0x7f).contains(&byte) && !matches!(byte, b'"' | b';' | b'\\')
				}) {
					return std::str::from_utf8(value).ok();
				}
			}
		}
		None
	}
}

/// strings.TrimSpace preserves malformed UTF-8 bytes. Only trim valid Unicode
/// whitespace at either edge rather than rejecting or replacing the whole value.
pub(super) fn trim_go_space_bytes(mut value: &[u8]) -> &[u8] {
	if let Some(first) = value.utf8_chunks().next() {
		let valid = first.valid();
		value = &value[valid.len() - valid.trim_start().len()..];
	}
	if let Some(last) = value.utf8_chunks().last()
		&& last.invalid().is_empty()
	{
		let valid = last.valid();
		value = &value[..value.len() - (valid.len() - valid.trim_end().len())];
	}
	value
}
