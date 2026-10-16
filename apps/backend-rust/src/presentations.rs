//! Presentation list/detail/delete behavior from the reference Go service.

use axum::{
	Router,
	extract::{Path, RawQuery, State},
	http::{HeaderMap, StatusCode},
	response::Response,
	routing::get,
};
use chrono::NaiveDateTime;
use serde::Serialize;
use serde_json::{json, value::RawValue};

use crate::http::ApiState;

pub fn router(state: ApiState) -> Router {
	Router::new()
		.route("/presentations", get(list))
		.route("/presentations/{id}", get(detail).delete(delete))
		.with_state(state)
}

struct Presentation {
	id: String,
	user_id: String,
	title: String,
	prompt: String,
	slides_data: String,
	created_at: NaiveDateTime,
	updated_at: NaiveDateTime,
}

async fn list(
	State(state): State<ApiState>,
	RawQuery(query): RawQuery,
	headers: HeaderMap,
) -> Response {
	let Some(user) = state.auth.user_id(&headers) else {
		return error(StatusCode::UNAUTHORIZED, "Authentication required");
	};
	let limit = match pagination(&query_value(query.as_deref(), "limit"), "limit", 20, 1, 100) {
		Ok(value) => value,
		Err(message) => return error(StatusCode::BAD_REQUEST, &message),
	};
	let offset = match pagination(
		&query_value(query.as_deref(), "offset"),
		"offset",
		0,
		0,
		i64::MAX,
	) {
		Ok(value) => value,
		Err(message) => return error(StatusCode::BAD_REQUEST, &message),
	};
	let total = match sqlx::query_scalar!(
		"SELECT count(*) AS \"count!\" FROM presentations WHERE user_id = $1",
		user
	)
	.fetch_one(&state.database)
	.await
	{
		Ok(total) => total,
		Err(err) => return database_error("count presentations", err),
	};
	let rows = match sqlx::query_as!(
		Presentation,
		"SELECT id, user_id, title, prompt, slides_data::text AS \"slides_data!\", created_at, updated_at FROM presentations WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3",
		user, limit, offset
	).fetch_all(&state.database).await {
		Ok(rows) => rows,
		Err(err) => return database_error("list presentations", err),
	};
	let has_more = offset.saturating_add(rows.len() as i64) < total;
	let presentations: Vec<_> = rows
		.into_iter()
		.map(|row| {
			let summary = summary::read(&row.slides_data);
			json!({
				"id": row.id, "title": row.title, "prompt": row.prompt,
				"slide_count": summary.slide_count, "status": summary.status,
				"has_research": summary.has_research,
				"created_at": crate::rfc3339_nano(row.created_at.and_utc()),
				"updated_at": crate::rfc3339_nano(row.updated_at.and_utc())
			})
		})
		.collect();
	response(
		StatusCode::OK,
		json!({
			"presentations": presentations, "total": total,
			"limit": limit, "offset": offset, "has_more": has_more
		}),
	)
}

async fn find(state: &ApiState, id: &str) -> Result<Option<Presentation>, sqlx::Error> {
	sqlx::query_as!(
		Presentation,
		"SELECT id, user_id, title, prompt, slides_data::text AS \"slides_data!\", created_at, updated_at FROM presentations WHERE id = $1",
		id
	).fetch_optional(&state.database).await
}

async fn detail(
	State(state): State<ApiState>,
	Path(id): Path<String>,
	headers: HeaderMap,
) -> Response {
	let Some(user) = state.auth.user_id(&headers) else {
		return error(StatusCode::UNAUTHORIZED, "Authentication required");
	};
	let id = id.trim();
	if id.is_empty() {
		return error(StatusCode::BAD_REQUEST, "Invalid presentation ID");
	}
	match find(&state, id).await {
		Ok(Some(row)) if row.user_id == user => {
			#[derive(Serialize)]
			struct Detail<'a> {
				id: String,
				title: String,
				prompt: String,
				slides_data: &'a RawValue,
				created_at: String,
				updated_at: String,
			}
			let Ok(slides_data) = serde_json::from_str::<&RawValue>(&row.slides_data) else {
				return error(
					StatusCode::BAD_REQUEST,
					"scan presentation: invalid slides data JSON",
				);
			};
			#[derive(Serialize)]
			struct Body<T> {
				presentation: T,
			}
			response(
				StatusCode::OK,
				Body {
					presentation: Detail {
						id: row.id,
						title: row.title,
						prompt: row.prompt,
						slides_data,
						created_at: crate::rfc3339_nano(row.created_at.and_utc()),
						updated_at: crate::rfc3339_nano(row.updated_at.and_utc()),
					},
				},
			)
		}
		Ok(Some(_)) => error(StatusCode::FORBIDDEN, "unauthorized access to presentation"),
		Ok(None) => error(StatusCode::NOT_FOUND, "presentation not found"),
		Err(err) => database_error("scan presentation", err),
	}
}

async fn delete(
	State(state): State<ApiState>,
	Path(id): Path<String>,
	headers: HeaderMap,
) -> Response {
	let Some(user) = state.auth.user_id(&headers) else {
		return error(StatusCode::UNAUTHORIZED, "Authentication required");
	};
	let id = id.trim();
	if id.is_empty() {
		return error(StatusCode::BAD_REQUEST, "Invalid presentation ID");
	}
	// Keep the reference guard's behavior, including its best-effort database read.
	let active = sqlx::query_scalar!(
		"SELECT EXISTS (SELECT 1 FROM generation_point_operations WHERE presentation_id = $1 AND user_id = $2 AND status = 'reserved') AS \"active!\"",
		id, user
	).fetch_one(&state.database).await.unwrap_or(false);
	if active {
		return error(
			StatusCode::CONFLICT,
			"Presentation generation is still active",
		);
	}
	match sqlx::query!(
		"DELETE FROM presentations WHERE id = $1 AND user_id = $2",
		id,
		user
	)
	.execute(&state.database)
	.await
	{
		Ok(result) if result.rows_affected() > 0 => Response::builder()
			.status(StatusCode::NO_CONTENT)
			.body(axum::body::Body::empty())
			.unwrap(),
		Err(err) => database_error("delete presentation", err),
		Ok(_) => match find(&state, id).await {
			Ok(Some(row)) if row.user_id != user => {
				error(StatusCode::FORBIDDEN, "unauthorized access to presentation")
			}
			Ok(_) => error(StatusCode::NOT_FOUND, "presentation not found"),
			Err(err) => database_error("scan presentation", err),
		},
	}
}

fn pagination(
	raw: &str,
	field: &str,
	fallback: i64,
	minimum: i64,
	maximum: i64,
) -> Result<i64, String> {
	if raw.is_empty() {
		return Ok(fallback);
	}
	if raw.trim() != raw {
		return Err(format!("{field} must be an integer"));
	}
	raw.parse::<i64>()
		.ok()
		.filter(|value| (minimum..=maximum).contains(value))
		.ok_or_else(|| format!("{field} must be between {minimum} and {maximum}"))
}

/// Go URL.Query discards malformed pairs, ignores semicolon pairs, and uses the first value.
fn query_value(query: Option<&str>, field: &str) -> String {
	fn decode(text: &str) -> Option<String> {
		let bytes = text.as_bytes();
		for (index, byte) in bytes.iter().enumerate() {
			if *byte == b'%'
				&& !bytes
					.get(index + 1..index + 3)
					.is_some_and(|digits| digits.iter().all(u8::is_ascii_hexdigit))
			{
				return None;
			}
		}
		Some(
			percent_encoding::percent_decode_str(&text.replace('+', " "))
				.decode_utf8_lossy()
				.into_owned(),
		)
	}
	for pair in query.unwrap_or_default().split('&') {
		if pair.contains(';') {
			continue;
		}
		let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
		if let (Some(key), Some(value)) = (decode(key), decode(value))
			&& key == field
		{
			return value;
		}
	}
	String::new()
}

fn database_error(context: &str, err: sqlx::Error) -> Response {
	let message = match &err {
		sqlx::Error::PoolClosed => "sql: database is closed".to_owned(),
		sqlx::Error::Database(err) => {
			format!(
				"ERROR: {} (SQLSTATE {})",
				err.message(),
				err.code().unwrap_or_default()
			)
		}
		_ => err.to_string(),
	};
	error(StatusCode::BAD_REQUEST, &format!("{context}: {message}"))
}

fn error(status: StatusCode, message: &str) -> Response {
	response(status, json!({"error": {"message": message}}))
}

fn response(status: StatusCode, value: impl Serialize) -> Response {
	use axum::response::IntoResponse;
	// Match encoding/json HTML escaping and preserve raw JSONB numbers in details.
	let body = serde_json::to_string(&value)
		.unwrap()
		.replace('&', "\\u0026")
		.replace('<', "\\u003c")
		.replace('>', "\\u003e")
		.replace('\u{2028}', "\\u2028")
		.replace('\u{2029}', "\\u2029");
	(
		status,
		[("content-type", "application/json; charset=utf-8")],
		format!("{body}\n"),
	)
		.into_response()
}

mod summary;
