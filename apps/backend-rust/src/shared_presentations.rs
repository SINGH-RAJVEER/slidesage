//! Public reads resolve the live token in PostgreSQL before reading current content.

use axum::{
	Router,
	extract::{Path, State, rejection::PathRejection},
	http::StatusCode,
	response::Response,
	routing::get,
};
use serde::{
	Deserialize, Deserializer, Serialize,
	de::{MapAccess, Visitor},
};
use serde_json::{json, value::RawValue};
use sha2::{Digest, Sha256};

use crate::{
	card_documents::{ReadError, read_content, response},
	http::ApiState,
};

pub fn router(state: ApiState) -> Router {
	Router::new()
		.route("/shared/{token}", get(current))
		.with_state(state)
}

async fn current(
	State(state): State<ApiState>,
	path: Result<Path<String>, PathRejection>,
) -> Response {
	let Ok(Path(token)) = path else {
		return invalid_link();
	};
	if !valid_token(&token) {
		return invalid_link();
	}
	let digest = hex::encode(Sha256::digest(token.as_bytes()));
	let row = match sqlx::query!("SELECT p.id, p.user_id FROM presentation_shares s JOIN presentations p ON p.id = s.presentation_id WHERE s.token_sha256 = $1 AND s.revoked_at IS NULL AND COALESCE(p.slides_data->>'status', '') = 'ready'", digest).fetch_optional(&state.database).await {
		Ok(Some(row)) => row,
		Ok(None) => return invalid_link(),
		Err(error) => return failure(error),
	};
	let (document, assets) = match read_content(&state, &row.id, &row.user_id).await {
		Ok(content) => content,
		Err(ReadError::Missing | ReadError::NoRevision) => return invalid_link(),
		Err(ReadError::Database(error)) => return failure(error),
		Err(ReadError::Invalid) => return internal_error(),
	};
	let encoded = match sqlx::query_scalar!("SELECT COALESCE(slides_data->'sources', '[]'::jsonb)::text AS \"sources!\" FROM presentations WHERE id = $1", row.id).fetch_one(&state.database).await {
		Ok(encoded) => encoded,
		Err(error) => return failure(error),
	};
	#[derive(Serialize)]
	struct Body<'a> {
		assets: std::collections::BTreeMap<String, crate::card_documents::Asset>,
		document: &'a RawValue,
		sources: Option<Vec<Source>>,
	}
	response(
		StatusCode::OK,
		Body {
			assets,
			document: &document,
			sources: sources(&encoded),
		},
	)
}

// RawURLEncoding's non-strict decoder ignores CR/LF and the unused final bits.
// Hashing still uses the exact original spelling, including those ignored bytes.
fn valid_token(token: &str) -> bool {
	let mut count = 0;
	for byte in token.bytes() {
		if matches!(byte, b'\r' | b'\n') {
			continue;
		}
		if !(byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')) {
			return false;
		}
		count += 1;
	}
	count == 43
}

#[derive(Default, Serialize)]
struct Source {
	url: String,
	#[serde(skip_serializing_if = "String::is_empty")]
	title: String,
}

// Go ignores json.Unmarshal's error here. It still fills every array element
// and every valid field, retaining zero values for fields with the wrong type.
fn sources(encoded: &str) -> Option<Vec<Source>> {
	if encoded.trim() == "null" {
		return None;
	}
	let Ok(values) = serde_json::from_str::<Vec<Box<RawValue>>>(encoded) else {
		return Some(Vec::new());
	};
	Some(
		values
			.into_iter()
			.map(|value| {
				let mut source = Source::default();
				if let Ok(Fields(fields)) = serde_json::from_str(value.get()) {
					for (name, value) in fields {
						if let Ok(text) = serde_json::from_str::<String>(value.get()) {
							if name.eq_ignore_ascii_case("url") {
								source.url = text;
							} else if name.eq_ignore_ascii_case("title") {
								source.title = text;
							}
						}
					}
				}
				source
			})
			.collect(),
	)
}

struct Fields(Vec<(String, Box<RawValue>)>);
impl<'de> Deserialize<'de> for Fields {
	fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
		struct Object;
		impl<'de> Visitor<'de> for Object {
			type Value = Fields;
			fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
				formatter.write_str("an object")
			}
			fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Fields, M::Error> {
				let mut fields = Vec::new();
				while let Some(entry) = map.next_entry()? {
					fields.push(entry);
				}
				Ok(Fields(fields))
			}
		}
		decoder.deserialize_map(Object)
	}
}

fn invalid_link() -> Response {
	response(
		StatusCode::NOT_FOUND,
		json!({"error":{"message":"This link is not valid"}}),
	)
}
fn internal_error() -> Response {
	response(
		StatusCode::INTERNAL_SERVER_ERROR,
		json!({"error":{"message":"Unable to load the presentation"}}),
	)
}
fn failure(error: sqlx::Error) -> Response {
	eprintln!("load shared presentation: {error}");
	internal_error()
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn raw_url_tokens_allow_noncanonical_bits_and_line_breaks() {
		for token in [
			"A".repeat(43),
			"_".repeat(43),
			format!("{}\r\nA", "A".repeat(42)),
		] {
			assert!(valid_token(&token));
		}
		for token in [
			"A".repeat(42),
			"A".repeat(44),
			format!("{}=", "A".repeat(43)),
			format!("{}+", "A".repeat(42)),
			format!("{}é", "A".repeat(42)),
		] {
			assert!(!valid_token(&token));
		}
	}
	#[test]
	fn citation_decode_retains_go_partial_results_without_private_fields() {
		for (input, expected) in [
			("null", "null"),
			("true", "[]"),
			("{}", "[]"),
			(
				r#"[{"url":"a","title":"A","snippet":"private"},1,null,[],{"url":false,"title":"kept"},{"URL":"first","url":null,"Title":99}]"#,
				r#"[{"url":"a","title":"A"},{"url":""},{"url":""},{"url":""},{"url":"","title":"kept"},{"url":"first"}]"#,
			),
		] {
			assert_eq!(serde_json::to_string(&sources(input)).unwrap(), expected);
		}
	}
}
