use axum::{
	Json, Router,
	body::{Body, to_bytes},
	http::{HeaderMap, Method, StatusCode, Uri},
	response::{IntoResponse, Response},
};
use serde_json::json;
use std::error::Error;

pub use crate::cards::SCHEMA_VERSION as CARD_SCHEMA_VERSION;

const MAX_BODY_UNITS: usize = 1024 * 1024;

/// Curated templates and metadata are implemented. Conversion/PPTX writing are pending.
pub fn router() -> Router {
	Router::new().fallback(dispatch)
}

async fn dispatch(method: Method, uri: Uri, headers: HeaderMap, body: Body) -> Response {
	match normalized_path(uri.path()).as_str() {
		"/health" => health(method).await,
		"/v1/schema" => schema(method).await,
		"/v1/templates" => templates(method, headers, body).await,
		"/v1/cards"
		| "/v1/documents"
		| "/v1/documents/validate"
		| "/v1/documents/drafts"
		| "/v1/documents/pptx" => pending(method, headers).await,
		_ => not_found().await,
	}
}

/// Bun routes URL.pathname, which applies WHATWG dot-segment and backslash
/// normalization even when an HTTP client sends an unnormalized request target.
fn normalized_path(path: &str) -> String {
	let path = path.replace('\\', "/");
	let mut output = Vec::new();
	let mut segments = path.split('/').peekable();
	while let Some(segment) = segments.next() {
		let dot = segment.to_ascii_lowercase().replace("%2e", ".");
		match dot.as_str() {
			"." => {
				if segments.peek().is_none() {
					output.push("");
				}
			}
			".." => {
				if output.len() > 1 {
					output.pop();
				}
				if segments.peek().is_none() {
					output.push("");
				}
			}
			_ => output.push(segment),
		}
	}
	output.join("/")
}

fn negotiation_error(method: Method, headers: &HeaderMap) -> Option<Response> {
	if method != Method::POST {
		return Some(json_response(
			StatusCode::NOT_FOUND,
			json!({"error": "not found"}),
		));
	}
	let versions: Vec<String> = headers
		.get_all("X-Card-Schema-Version")
		.iter()
		.map(|value| {
			value
				.as_bytes()
				.iter()
				.map(|byte| char::from(*byte))
				.collect()
		})
		.collect();
	let version = (!versions.is_empty()).then(|| versions.join(", "));
	if version.as_deref() != Some("3") {
		return Some(json_response(
			StatusCode::CONFLICT,
			json!({"error": format!(
				"schema version {} is not served; this converter serves {}",
				version.as_deref().unwrap_or("(missing)"), CARD_SCHEMA_VERSION
			)}),
		));
	}
	None
}

async fn pending(method: Method, headers: HeaderMap) -> Response {
	match negotiation_error(method, &headers) {
		None => not_found().await,
		Some(response) => response,
	}
}

async fn templates(method: Method, headers: HeaderMap, body: Body) -> Response {
	if let Some(response) = negotiation_error(method, &headers) {
		return response;
	}
	match read_template_id(headers, body).await {
		Ok(id) => match crate::cards::template_deck(&id) {
			Some(deck) => json_response(StatusCode::OK, deck),
			None => json_response(
				StatusCode::NOT_FOUND,
				json!({"error": "template not found"}),
			),
		},
		Err((status, error)) => json_response(status, json!({"error": error})),
	}
}

async fn read_template_id(
	headers: HeaderMap,
	body: Body,
) -> Result<String, (StatusCode, &'static str)> {
	let too_large = (StatusCode::PAYLOAD_TOO_LARGE, "request body is too large");
	let invalid_json = (StatusCode::BAD_REQUEST, "request body is not JSON");
	if headers
		.get("content-length")
		.and_then(|value| value.to_str().ok())
		.and_then(|value| value.parse::<f64>().ok())
		.is_some_and(|value| value > MAX_BODY_UNITS as f64)
	{
		return Err(too_large);
	}
	// Bun checks request.text().length, measured in UTF-16 code units. Three
	// UTF-8 bytes per unit plus an optional BOM bound the matching byte read.
	let bytes = to_bytes(body, MAX_BODY_UNITS * 3 + 3)
		.await
		.map_err(|error| {
			if error
				.source()
				.is_some_and(|source| source.is::<http_body_util::LengthLimitError>())
			{
				too_large
			} else {
				(StatusCode::INTERNAL_SERVER_ERROR, "conversion failed")
			}
		})?;
	let text = String::from_utf8_lossy(&bytes);
	let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
	if text.encode_utf16().count() > MAX_BODY_UNITS {
		return Err(too_large);
	}
	let normalized = crate::http::json::replace_lone_surrogates(text);
	let raw: Box<serde_json::value::RawValue> =
		serde_json::from_str(&normalized).map_err(|_| invalid_json)?;
	if !raw.get().starts_with('{') {
		return Err((StatusCode::BAD_REQUEST, "request body must be an object"));
	}
	let input: std::collections::HashMap<String, Box<serde_json::value::RawValue>> =
		serde_json::from_str(raw.get()).map_err(|_| invalid_json)?;
	let id = input
		.get("templateId")
		.and_then(|value| serde_json::from_str::<String>(value.get()).ok())
		.filter(|value| !value.trim_matches(js_whitespace).is_empty())
		.ok_or((
			StatusCode::BAD_REQUEST,
			"templateId must be a non-empty string",
		))?;
	Ok(id)
}

fn js_whitespace(character: char) -> bool {
	matches!(
		character,
		'\u{0009}'..='\u{000d}'
			| '\u{0020}'
			| '\u{00a0}'
			| '\u{1680}'
			| '\u{2000}'..='\u{200a}'
			| '\u{2028}'
			| '\u{2029}'
			| '\u{202f}'
			| '\u{205f}'
			| '\u{3000}'
			| '\u{feff}'
	)
}

async fn health(method: Method) -> Response {
	if method != Method::GET {
		return not_found().await;
	}
	json_response(
		StatusCode::OK,
		json!({"status": "ok", "schemaVersion": CARD_SCHEMA_VERSION}),
	)
}

async fn schema(method: Method) -> Response {
	if method != Method::GET {
		return not_found().await;
	}
	json_response(StatusCode::OK, crate::cards::drafting_schema())
}

async fn not_found() -> Response {
	json_response(StatusCode::NOT_FOUND, json!({"error": "not found"}))
}

fn json_response(status: StatusCode, value: impl serde::Serialize) -> Response {
	(
		status,
		[("content-type", "application/json;charset=utf-8")],
		Json(value),
	)
		.into_response()
}
