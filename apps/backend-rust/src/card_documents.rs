//! Owner reads of the current immutable card document and its fresh asset metadata.

use std::{
	collections::{BTreeMap, BTreeSet},
	time::Duration,
};

use axum::{
	Router,
	extract::{Path, State},
	http::{HeaderMap, StatusCode},
	response::{IntoResponse, Response},
	routing::get,
};
use chrono::{DateTime, Utc};
use serde::{
	Deserialize, Deserializer, Serialize,
	de::{MapAccess, Visitor},
};
use serde_json::{json, value::RawValue};

use crate::http::ApiState;

pub fn router(state: ApiState) -> Router {
	Router::new()
		.route("/presentations/{id}/document", get(current))
		.with_state(state)
}

struct Revision {
	presentation_id: String,
	revision: i32,
	sha256: String,
	byte_size: i64,
	card_count: i32,
	schema_version: i32,
	operation_kind: String,
	base_revision: Option<i32>,
	created_at: DateTime<Utc>,
	document: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RevisionView<'a> {
	revision: i32,
	sha256: &'a str,
	byte_size: i64,
	card_count: i32,
	schema_version: i32,
	operation_kind: &'a str,
	#[serde(skip_serializing_if = "Option::is_none")]
	base_revision: Option<i32>,
	created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
	mime_type: String,
	byte_size: i64,
	width: i32,
	height: i32,
	source: Box<RawValue>,
	#[serde(skip_serializing_if = "Option::is_none")]
	url: Option<String>,
}

enum ReadError {
	Missing,
	NoRevision,
	Invalid,
	Database(sqlx::Error),
}

impl From<sqlx::Error> for ReadError {
	fn from(error: sqlx::Error) -> Self {
		Self::Database(error)
	}
}

async fn current(
	State(state): State<ApiState>,
	Path(id): Path<String>,
	headers: HeaderMap,
) -> Response {
	let Some(user) = state.auth.user_id(&headers) else {
		return error(StatusCode::UNAUTHORIZED, "Authentication required");
	};
	match load(&state, &id, &user).await {
		Ok((revision, document, assets)) => {
			#[derive(Serialize)]
			struct Body<'a> {
				assets: BTreeMap<String, Asset>,
				document: &'a RawValue,
				revision: RevisionView<'a>,
			}
			response(
				StatusCode::OK,
				Body {
					assets,
					document: &document,
					revision: RevisionView {
						revision: revision.revision,
						sha256: &revision.sha256,
						byte_size: revision.byte_size,
						card_count: revision.card_count,
						schema_version: revision.schema_version,
						operation_kind: &revision.operation_kind,
						base_revision: revision.base_revision,
						created_at: revision_timestamp(revision.created_at),
					},
				},
			)
		}
		Err(ReadError::Missing) => error(StatusCode::NOT_FOUND, "Presentation not found"),
		Err(ReadError::NoRevision) => error(
			StatusCode::CONFLICT,
			"This presentation has no saved document yet",
		),
		Err(error_value) => {
			if let ReadError::Database(error_value) = error_value {
				eprintln!("load card document: {error_value}");
			}
			error(
				StatusCode::INTERNAL_SERVER_ERROR,
				"Unable to load the presentation",
			)
		}
	}
}

pub(crate) fn revision_timestamp(time: DateTime<Utc>) -> String {
	// pgx scans timestamptz using time.Local. These revision timestamps retain
	// that local offset, unlike the API's UTC timestamp-without-zone fields.
	offset_timestamp(time.with_timezone(&chrono::Local).fixed_offset())
}

fn offset_timestamp(time: DateTime<chrono::FixedOffset>) -> String {
	let text = time.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
	let offset_start = text.len() - if text.ends_with('Z') { 1 } else { 6 };
	let (main, offset) = text.split_at(offset_start);
	format!(
		"{}{offset}",
		main.trim_end_matches('0').trim_end_matches('.')
	)
}

async fn load(
	state: &ApiState,
	id: &str,
	user: &str,
) -> Result<(Revision, Box<RawValue>, BTreeMap<String, Asset>), ReadError> {
	// Omitting document from the cache-hit query avoids loading its TOAST body.
	let selected = if state.cache.is_some() {
		sqlx::query_as!(Revision,
			"SELECT r.presentation_id, r.revision, r.sha256::text AS \"sha256!\", r.byte_size, r.card_count, r.schema_version, r.operation_kind::text AS \"operation_kind!\", r.base_revision, r.created_at, NULL::text AS \"document?\" FROM presentations p JOIN card_revisions r ON r.presentation_id = p.id AND r.revision = p.current_card_revision WHERE p.id = $1 AND p.user_id = $2",
			id, user).fetch_optional(&state.database).await?
	} else {
		sqlx::query_as!(Revision,
			"SELECT r.presentation_id, r.revision, r.sha256::text AS \"sha256!\", r.byte_size, r.card_count, r.schema_version, r.operation_kind::text AS \"operation_kind!\", r.base_revision, r.created_at, r.document::text AS \"document?\" FROM presentations p JOIN card_revisions r ON r.presentation_id = p.id AND r.revision = p.current_card_revision WHERE p.id = $1 AND p.user_id = $2",
			id, user).fetch_optional(&state.database).await?
	};
	let Some(revision) = selected else {
		let exists = sqlx::query_scalar!(
			"SELECT EXISTS (SELECT 1 FROM presentations WHERE id = $1 AND user_id = $2) AS \"exists!\"",
			id,
			user
		)
		.fetch_one(&state.database)
		.await?;
		return Err(if exists {
			ReadError::NoRevision
		} else {
			ReadError::Missing
		});
	};
	let document = if let Some(cache) = &state.cache {
		let key = crate::cache::key(&[
			"card-body",
			user,
			id,
			&revision.revision.to_string(),
			&revision.sha256,
		]);
		if let Some(document) = cache
			.get(&key)
			.await
			.and_then(|value| raw_document(&value).ok())
		{
			document
		} else {
			// Authorization is repeated after the cache lookup. Ownership and the
			// current pointer are never trusted to disposable cache entries.
			let body = sqlx::query_scalar!("SELECT r.document::text AS \"document!\" FROM card_revisions r JOIN presentations p ON p.id = r.presentation_id WHERE p.id = $1 AND p.user_id = $2 AND r.revision = $3", id, user, revision.revision)
				.fetch_optional(&state.database).await?.ok_or(ReadError::Missing)?;
			let document = raw_document(body.as_bytes())?;
			cache
				.set(&key, body.as_bytes(), Duration::from_secs(3600))
				.await;
			document
		}
	} else {
		raw_document(
			revision
				.document
				.as_deref()
				.ok_or(ReadError::Invalid)?
				.as_bytes(),
		)?
	};
	let ids = referenced_assets(document.get())?;
	let mut assets = BTreeMap::new();
	if !ids.is_empty() {
		let rows = sqlx::query!("SELECT sha256::text AS \"sha256!\", mime_type, COALESCE(byte_size, 0) AS \"byte_size!\", width, height, source::text AS \"source!\", COALESCE(remote_url, '') AS \"url!\" FROM card_assets WHERE presentation_id = $1 AND sha256 = ANY($2)", revision.presentation_id, &ids)
			.fetch_all(&state.database).await?;
		for row in rows {
			assets.insert(
				row.sha256,
				Asset {
					mime_type: row.mime_type,
					byte_size: row.byte_size,
					width: row.width,
					height: row.height,
					source: raw_document(row.source.as_bytes())?,
					url: (!row.url.is_empty()).then_some(row.url),
				},
			);
		}
	}
	Ok((revision, document, assets))
}

fn raw_document(bytes: &[u8]) -> Result<Box<RawValue>, ReadError> {
	let text = go_utf8(bytes);
	let raw = serde_json::from_str::<Box<RawValue>>(&text).map_err(|_| ReadError::Invalid)?;
	// encoding/json compacts RawMessage without converting JSONB numeric tokens.
	let mut compact = String::with_capacity(raw.get().len());
	let mut quoted = false;
	let mut escaped = false;
	for character in raw.get().chars() {
		if quoted || !matches!(character, ' ' | '\n' | '\r' | '\t') {
			compact.push(character);
		}
		if escaped {
			escaped = false;
		} else if quoted && character == '\\' {
			escaped = true;
		} else if character == '"' {
			quoted = !quoted;
		}
	}
	RawValue::from_string(compact).map_err(|_| ReadError::Invalid)
}

fn go_utf8(mut bytes: &[u8]) -> std::borrow::Cow<'_, str> {
	if let Ok(text) = std::str::from_utf8(bytes) {
		return text.into();
	}
	let mut text = String::with_capacity(bytes.len());
	loop {
		match std::str::from_utf8(bytes) {
			Ok(valid) => {
				text.push_str(valid);
				return text.into();
			}
			Err(error) => {
				let (valid, invalid) = bytes.split_at(error.valid_up_to());
				text.push_str(std::str::from_utf8(valid).unwrap());
				text.push('\u{fffd}');
				bytes = &invalid[1..];
			}
		}
	}
}

/// Keep duplicate fields and raw unknown values, matching Go's struct decoder.
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

fn fields(raw: &str) -> Result<Vec<(String, Box<RawValue>)>, ReadError> {
	if raw.trim() == "null" {
		return Ok(Vec::new());
	}
	serde_json::from_str::<Fields>(raw)
		.map(|fields| fields.0)
		.map_err(|_| ReadError::Invalid)
}

fn matches(key: &str, field: &str) -> bool {
	key.replace('ſ', "s").eq_ignore_ascii_case(field)
}

fn referenced_assets(document: &str) -> Result<Vec<String>, ReadError> {
	// JSONB rejects lone surrogates, but a syntactically valid disposable cache
	// entry may contain them. Go replaces them while decoding struct fields.
	let normalized = crate::http::json::replace_lone_surrogates(document);
	let mut cards = BTreeMap::new();
	for (key, value) in fields(&normalized)? {
		if !matches(&key, "cards") {
			continue;
		}
		if value.get() == "null" {
			cards.clear();
			continue;
		}
		for (id, card) in fields(value.get())? {
			// Go reuses slice backing values across duplicate nodes fields. Decode
			// each occurrence in order, retaining fields an object omits or nulls.
			let mut nodes = Vec::<(String, String)>::new();
			let mut node_count = 0;
			for (key, value) in fields(card.get())? {
				if matches(&key, "nodes") {
					if value.get() == "null" {
						nodes.clear();
						node_count = 0;
						continue;
					}
					let values: Vec<Box<RawValue>> =
						serde_json::from_str(value.get()).map_err(|_| ReadError::Invalid)?;
					node_count = values.len();
					if values.is_empty() {
						nodes.clear();
					}
					for (index, node) in values.into_iter().enumerate() {
						if index == nodes.len() {
							nodes.push((String::new(), String::new()));
						}
						let (kind, asset_id) = &mut nodes[index];
						for (key, value) in fields(node.get())? {
							if value.get() == "null" {
								continue;
							}
							if matches(&key, "type") {
								*kind = serde_json::from_str(value.get())
									.map_err(|_| ReadError::Invalid)?;
							} else if matches(&key, "assetId") {
								*asset_id = serde_json::from_str(value.get())
									.map_err(|_| ReadError::Invalid)?;
							}
						}
					}
				}
			}
			let mut images = BTreeSet::new();
			for (kind, asset_id) in nodes.into_iter().take(node_count) {
				if kind == "image" {
					images.insert(asset_id);
				}
			}
			cards.insert(id, images);
		}
	}
	Ok(cards
		.into_values()
		.flatten()
		.collect::<BTreeSet<_>>()
		.into_iter()
		.collect())
}

fn error(status: StatusCode, message: &str) -> Response {
	response(status, json!({"error": {"message": message}}))
}

fn response(status: StatusCode, value: impl Serialize) -> Response {
	let body = serde_json::to_string(&value)
		.unwrap()
		.replace('&', "\\u0026")
		.replace('<', "\\u003c")
		.replace('>', "\\u003e")
		.replace('\u{2028}', "\\u2028")
		.replace('\u{2029}', "\\u2029");
	(
		status,
		[
			("content-type", "application/json"),
			("cache-control", "private, no-store"),
		],
		format!("{body}\n"),
	)
		.into_response()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn revision_timestamp_preserves_local_offsets_and_go_nanosecond_trimming() {
		for (input, expected) in [
			(
				"2026-01-02T08:34:05.123400000+05:30",
				"2026-01-02T08:34:05.1234+05:30",
			),
			("2026-01-02T03:04:05.000000000Z", "2026-01-02T03:04:05Z"),
			(
				"2026-01-02T03:04:05.000000001-07:00",
				"2026-01-02T03:04:05.000000001-07:00",
			),
		] {
			assert_eq!(
				offset_timestamp(DateTime::parse_from_rfc3339(input).unwrap()),
				expected
			);
		}
		let time = DateTime::parse_from_rfc3339("2026-01-02T03:04:05.123456Z")
			.unwrap()
			.with_timezone(&Utc);
		let local = time.with_timezone(&chrono::Local).fixed_offset();
		let formatted = revision_timestamp(time);
		assert_eq!(DateTime::parse_from_rfc3339(&formatted).unwrap(), local);
		assert_eq!(formatted, offset_timestamp(local));
	}

	#[test]
	fn asset_references_follow_go_partial_struct_decoding() {
		for (document, expected) in [
			(
				r#"{"cards":{"c_1":{"nodes":[{"type":"image","assetId":"b"},{"type":"heading"}]},"c_2":{"nodes":[{"type":"image","assetId":"a"},{"type":"image","assetId":"b"}]}}}"#,
				vec!["a", "b"],
			),
			(
				r#"{"CARDſ":{"c":{"NODEſ":[{"TYPE":"image","ASSETID":"a"}]}}}"#,
				vec!["a"],
			),
			(
				r#"{"cards":{"a":{"nodes":[{"type":"image","assetId":"a"}]}},"CARDS":{"b":{"nodes":[{"type":"image","assetId":"b"}]}}}"#,
				vec!["a", "b"],
			),
			(
				r#"{"cards":{"a":{"nodes":[{"type":"image","assetId":"a"}]}},"CARDS":null}"#,
				vec![],
			),
			(
				r#"{"cards":{"a":{"nodes":[{"type":"image","assetId":"a"}]},"a":null}}"#,
				vec![],
			),
			(
				r#"{"cards":{"a":{"nodes":[{"type":"image","TYPE":null,"assetId":"a","ASSETID":null}]}}}"#,
				vec!["a"],
			),
			(
				r#"{"cards":{"a":{"nodes":[{"type":"image","assetId":"\ud800"}]}},"\udc00":1e400}"#,
				vec!["\u{fffd}"],
			),
			("null", vec![]),
		] {
			assert_eq!(
				referenced_assets(document).ok(),
				Some(expected.into_iter().map(str::to_owned).collect()),
				"{document}"
			);
		}
		for document in [
			"[]",
			"false",
			r#"{"cards":[]}"#,
			r#"{"cards":{"c":{"nodes":"bad"}}}"#,
			r#"{"cards":{"c":{"nodes":[{"type":1,"TYPE":"image"}]}}}"#,
		] {
			assert!(referenced_assets(document).is_err(), "{document}");
		}
	}

	#[test]
	fn document_compaction_preserves_raw_numeric_tokens_and_string_whitespace() {
		let document = raw_document(
			br#"{ "precise":123456789012345678901234567890, "text": "a b\\\" c", "huge":1e400 }"#,
		)
		.ok()
		.unwrap();
		assert_eq!(
			document.get(),
			r#"{"precise":123456789012345678901234567890,"text":"a b\\\" c","huge":1e400}"#
		);
		assert!(raw_document(b"broken JSON").is_err());
	}
}
