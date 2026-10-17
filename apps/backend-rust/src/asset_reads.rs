//! Owner and live-share image reads from recorded metadata and local objects.

use axum::{
	Router,
	body::Body,
	extract::{OriginalUri, State},
	http::{HeaderMap, Method, StatusCode, Uri},
	response::{IntoResponse, Response},
	routing::get,
};
use sha2::{Digest, Sha256};
use tokio_util::io::ReaderStream;

use crate::{
	card_documents::{ReadError, read_document, referenced_assets},
	http::ApiState,
};

pub fn router(state: ApiState) -> Router {
	Router::new()
		.route("/presentations/{id}/assets/{sha256}", get(owner))
		.route("/shared/{token}/assets/{sha256}", get(shared))
		.with_state(state)
}

fn parameter(uri: &Uri, index: usize) -> Vec<u8> {
	percent_encoding::percent_decode_str(uri.path().split('/').nth(index).unwrap_or_default())
		.collect()
}

async fn owner(
	State(state): State<ApiState>,
	OriginalUri(uri): OriginalUri,
	method: Method,
	headers: HeaderMap,
) -> Response {
	let Some(user) = state.auth.user_id(&headers) else {
		return error(StatusCode::UNAUTHORIZED, "Authentication required");
	};
	if state.objects.is_none() {
		return error(
			StatusCode::SERVICE_UNAVAILABLE,
			"Presentation storage is not configured",
		);
	}
	let Ok(id) = String::from_utf8(parameter(&uri, 2)) else {
		return internal_error();
	};
	match sqlx::query_scalar!("SELECT user_id FROM presentations WHERE id = $1", id)
		.fetch_optional(&state.database)
		.await
	{
		Ok(Some(owner)) if owner == user => {}
		Ok(_) => return image_missing(),
		Err(error) => return failure(error),
	};
	let Ok(digest) = String::from_utf8(parameter(&uri, 4)) else {
		return internal_error();
	};
	serve(&state, &id, &digest, &method, &headers).await
}

async fn shared(
	State(state): State<ApiState>,
	OriginalUri(uri): OriginalUri,
	method: Method,
	headers: HeaderMap,
) -> Response {
	let Ok(token) = String::from_utf8(parameter(&uri, 2)) else {
		return invalid_link();
	};
	if !crate::shared_presentations::valid_token(&token) {
		return invalid_link();
	}
	let token_digest = hex::encode(Sha256::digest(token.as_bytes()));
	let row = match sqlx::query!("SELECT p.id, p.user_id FROM presentation_shares s JOIN presentations p ON p.id = s.presentation_id WHERE s.token_sha256 = $1 AND s.revoked_at IS NULL AND COALESCE(p.slides_data->>'status', '') = 'ready'", token_digest).fetch_optional(&state.database).await {
		Ok(Some(row)) => row,
		Ok(None) => return invalid_link(),
		Err(error) => return failure(error),
	};
	let document = match read_document(&state, &row.id, &row.user_id).await {
		Ok(document) => document,
		Err(ReadError::Missing | ReadError::NoRevision) => return image_missing(),
		Err(ReadError::Database(error)) => return failure(error),
		Err(ReadError::Invalid) => return internal_error(),
	};
	let ids = match referenced_assets(document.get()) {
		Ok(ids) => ids,
		Err(_) => return internal_error(),
	};
	let bytes = parameter(&uri, 4);
	let Some(digest) = ids.iter().find(|id| id.as_bytes() == bytes) else {
		return image_missing();
	};
	serve(&state, &row.id, digest, &method, &headers).await
}

async fn serve(
	state: &ApiState,
	id: &str,
	digest: &str,
	method: &Method,
	headers: &HeaderMap,
) -> Response {
	let ids = [digest.to_owned()];
	let row = match sqlx::query!("SELECT sha256::text AS \"sha256!\", COALESCE(object_key, '') AS \"object_key!\", mime_type, COALESCE(byte_size, 0) AS \"byte_size!\", COALESCE(remote_url, '') AS \"url!\" FROM card_assets WHERE presentation_id = $1 AND sha256 = ANY($2)", id, &ids).fetch_optional(&state.database).await {
		Ok(Some(row)) if row.sha256 == digest => row,
		Ok(_) => return image_missing(),
		Err(error) => return failure(error),
	};
	if !row.url.is_empty() {
		return redirect(&row.url, method);
	}
	let Some(store) = &state.objects else {
		return error(
			StatusCode::SERVICE_UNAVAILABLE,
			"Image storage is not configured",
		);
	};
	let etag = format!("\"{}\"", row.sha256);
	// Go matches only the first header value, exactly, and emits no ETag on 304.
	if headers
		.get("if-none-match")
		.is_some_and(|value| value.as_bytes() == etag.as_bytes())
	{
		return StatusCode::NOT_MODIFIED.into_response();
	}
	let file = match store.open(&row.object_key).await {
		Ok(file) => file,
		Err(error) => {
			eprintln!("open image asset: {error}");
			return internal_error();
		}
	};
	let body = if method == Method::HEAD {
		Body::empty()
	} else {
		Body::from_stream(ReaderStream::new(file))
	};
	let response = Response::builder()
		.status(StatusCode::OK)
		.header("content-type", &row.mime_type)
		.header("content-length", row.byte_size.to_string())
		.header("cache-control", "private, max-age=31536000, immutable")
		.header("etag", etag)
		.header("x-content-type-options", "nosniff")
		.body(body);
	response.unwrap_or_else(|_| internal_error())
}

fn redirect(url: &str, method: &Method) -> Response {
	let mut location = String::new();
	for byte in url.bytes() {
		if byte.is_ascii() {
			location.push(byte as char);
		} else {
			use std::fmt::Write;
			let _ = write!(location, "%{byte:02x}");
		}
	}
	// net/http sanitizes header line breaks and trims HTTP whitespace when
	// writing Location. The HTML response still contains the original URL.
	let location = location.replace(['\r', '\n'], " ");
	let location = location.trim_matches([' ', '\t']);
	let escaped = url
		.replace('&', "&amp;")
		.replace('<', "&lt;")
		.replace('>', "&gt;")
		.replace('"', "&#34;")
		.replace('\'', "&#39;");
	let body = if method == Method::HEAD {
		// An unknown-length empty body keeps Axum from inventing Content-Length
		// before it strips the HEAD body. Go omits that header on redirects.
		Body::from_stream(ReaderStream::new(tokio::io::empty()))
	} else {
		Body::from(format!("<a href=\"{escaped}\">Found</a>.\n\n"))
	};
	(
		StatusCode::FOUND,
		[
			("content-type", "text/html; charset=utf-8"),
			("location", location),
		],
		body,
	)
		.into_response()
}

fn error(status: StatusCode, message: &str) -> Response {
	crate::card_documents::response(status, serde_json::json!({"error":{"message":message}}))
}
fn image_missing() -> Response {
	error(StatusCode::NOT_FOUND, "Image not found")
}
fn invalid_link() -> Response {
	error(StatusCode::NOT_FOUND, "This link is not valid")
}
fn internal_error() -> Response {
	error(
		StatusCode::INTERNAL_SERVER_ERROR,
		"Unable to load the presentation",
	)
}
fn failure(error: sqlx::Error) -> Response {
	eprintln!("load image asset: {error}");
	internal_error()
}

#[cfg(test)]
mod tests {
	use super::*;
	use tower::ServiceExt;

	#[tokio::test]
	async fn owner_authentication_and_storage_checks_precede_database_access() {
		let database = sqlx::postgres::PgPoolOptions::new()
			.connect_lazy("postgresql://unused@127.0.0.1:1/unused")
			.unwrap();
		database.close().await;
		let secret = b"asset-read-test-secret-32-bytes-long";
		let app = router(ApiState {
			database,
			auth: crate::auth::request::RequestAuth::new(secret, "slidesage_token"),
			rate_limit_secret: String::new(),
			cache: None,
			objects: None,
		});
		let token = crate::auth::jwt::issue_token(
			secret,
			"owner",
			"",
			chrono::Utc::now().timestamp(),
			3600,
		)
		.unwrap();
		for (authorization, status, message) in [
			(None, StatusCode::UNAUTHORIZED, "Authentication required"),
			(
				Some(format!("Bearer {token}")),
				StatusCode::SERVICE_UNAVAILABLE,
				"Presentation storage is not configured",
			),
		] {
			// Even an invalid UTF-8 presentation ID is checked after these guards.
			let mut request = axum::http::Request::get("/presentations/%FF/assets/not-a-digest");
			if let Some(authorization) = authorization {
				request = request.header("authorization", authorization);
			}
			let response = app
				.clone()
				.oneshot(request.body(Body::empty()).unwrap())
				.await
				.unwrap();
			assert_eq!(response.status(), status);
			assert_eq!(response.headers()["cache-control"], "private, no-store");
			let bytes = axum::body::to_bytes(response.into_body(), 1024)
				.await
				.unwrap();
			assert_eq!(
				serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
				serde_json::json!({"error":{"message":message}})
			);
		}
	}

	#[tokio::test]
	async fn remote_redirect_retains_go_body_and_percent_encodes_unicode() {
		let response = redirect("https://images.unsplash.com/é?a=1&b=\"x\"", &Method::GET);
		assert_eq!(response.status(), StatusCode::FOUND);
		assert_eq!(
			response.headers()["location"],
			"https://images.unsplash.com/%c3%a9?a=1&b=\"x\""
		);
		assert_eq!(
			axum::body::to_bytes(response.into_body(), 1024)
				.await
				.unwrap(),
			"<a href=\"https://images.unsplash.com/é?a=1&amp;b=&#34;x&#34;\">Found</a>.\n\n"
		);
		let response = redirect("https://images.unsplash.com/photo", &Method::HEAD);
		assert_eq!(
			response.headers()["content-type"],
			"text/html; charset=utf-8"
		);
		assert!(
			axum::body::to_bytes(response.into_body(), 1024)
				.await
				.unwrap()
				.is_empty()
		);
	}
}
