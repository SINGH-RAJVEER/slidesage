use axum::{
	Router,
	extract::{DefaultBodyLimit, Request, State},
	http::{HeaderValue, Method, StatusCode, header},
	middleware::{self, Next},
	response::Response,
};
use std::collections::HashSet;

#[derive(Clone)]
pub struct Security {
	allowed: HashSet<String>,
}

impl Security {
	pub fn new(origins: &str) -> Self {
		Self {
			allowed: origins
				.split(',')
				.map(|origin| origin.trim().to_owned())
				.collect(),
		}
	}

	pub fn from_env() -> Self {
		let defaults = "http://localhost:5173,http://127.0.0.1:5173,https://slidesage.app,https://www.slidesage.app";
		Self::new(&crate::env_or(
			"CORS_ORIGINS",
			&crate::env_or("CORS_ORIGIN", defaults),
		))
	}

	pub fn apply(self, router: Router) -> Router {
		router
			.layer(DefaultBodyLimit::max(1 << 20))
			.layer(middleware::from_fn_with_state(self, with_security))
	}
}

async fn with_security(State(config): State<Security>, request: Request, next: Next) -> Response {
	let origin = request.headers().get(header::ORIGIN).cloned();
	let origin_text = origin
		.as_ref()
		.and_then(|value| value.to_str().ok())
		.unwrap_or("");
	let allowed = config.allowed.contains(origin_text);
	let unsafe_method = matches!(
		*request.method(),
		Method::POST | Method::PUT | Method::PATCH | Method::DELETE
	);
	let cross_site = request
		.headers()
		.get("sec-fetch-site")
		.is_some_and(|value| value == "cross-site");
	// net/http exposes a decoded URL.Path to the original Go wrapper.
	let decoded_path =
		percent_encoding::percent_decode_str(request.uri().path()).decode_utf8_lossy();
	let forbidden = if request.method() == Method::OPTIONS {
		!origin_text.is_empty() && !allowed
	} else {
		unsafe_method
			&& decoded_path != "/billing/webhook"
			&& ((!origin_text.is_empty() && !allowed) || (origin_text.is_empty() && cross_site))
	};
	let mut response = if forbidden {
		super::error(StatusCode::FORBIDDEN, "Origin is not allowed")
	} else if request.method() == Method::OPTIONS {
		Response::builder()
			.status(StatusCode::NO_CONTENT)
			.body(axum::body::Body::empty())
			.unwrap()
	} else {
		next.run(request).await
	};
	let headers = response.headers_mut();
	headers.append(header::VARY, HeaderValue::from_static("Origin"));
	if allowed {
		headers.insert(
			header::ACCESS_CONTROL_ALLOW_ORIGIN,
			origin.unwrap_or(HeaderValue::from_static("")),
		);
		for (name, value) in [
			("access-control-allow-credentials", "true"),
			(
				"access-control-allow-headers",
				"Content-Type, Authorization, Idempotency-Key, Last-Event-ID",
			),
			(
				"access-control-expose-headers",
				"X-Generation-Job-ID, X-Presentation-ID",
			),
			(
				"access-control-allow-methods",
				"GET, POST, PUT, PATCH, DELETE, OPTIONS",
			),
			("access-control-max-age", "86400"),
		] {
			headers.insert(name, HeaderValue::from_static(value));
		}
	}
	response
}
