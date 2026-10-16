//! Cases from apps/api/internal/auth/password_test.go and jwt_test.go.

use slidesage_backend::auth::{
	jwt::{issue_token, verify_token},
	password::{hash_password, is_password_hash, verify_password},
};

#[test]
fn verify_password_supports_better_auth_scrypt() {
	let hash = "724139109330a29d64d3275159912c20:42699d3cc81f91c78053b7de1b635cf2203e2f376449b143ddb63fd7290d1bd490fba30d7bcc24de58bd8582a7cbcffca949c248dedd322e6233a1f704e3113b";
	assert!(verify_password(hash, "Pässword123!"));
	assert!(verify_password(hash, "Pa\u{308}ssword123!"));
	assert!(!verify_password(hash, "wrong password"));
}

#[test]
fn hash_password_uses_better_auth_format() {
	let hash = hash_password("correct horse battery staple");
	assert!(is_password_hash(&hash));
	assert!(verify_password(&hash, "correct horse battery staple"));
}

#[test]
fn verify_password_refuses_removed_formats() {
	for hash in [
		"5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
		"pbkdf2-sha256$100000$c2FsdHNhbHRzYWx0c2FsdA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"reset-required",
	] {
		assert!(!is_password_hash(hash));
		assert!(!verify_password(hash, "password"));
	}
}

#[test]
fn jwt_generation_and_verification() {
	let secret = b"test-secret-key-that-is-at-least-32-bytes-long";
	let token = issue_token(
		secret,
		"user-123",
		"test@example.com",
		chrono::Utc::now().timestamp(),
		3600,
	)
	.unwrap();
	assert_eq!(verify_token(secret, &token).unwrap(), "user-123");
	assert!(verify_token(b"different-key", &token).is_err());
}

#[test]
fn jwt_expiration_and_missing_subject() {
	let secret = b"test-secret-key-that-is-at-least-32-bytes-long";
	let now = chrono::Utc::now().timestamp();
	for ttl in [-3600, 0] {
		let token = issue_token(secret, "user-123", "", now, ttl).unwrap();
		assert!(verify_token(secret, &token).is_err());
	}
	let token = issue_token(secret, "", "", now, 3600).unwrap();
	assert!(verify_token(secret, &token).is_err());
}

#[test]
fn jwt_requires_hs256_expiration_and_valid_not_before() {
	use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
	let secret = b"test-secret-key-that-is-at-least-32-bytes-long";
	let now = chrono::Utc::now().timestamp();
	for (algorithm, claims) in [
		(
			Algorithm::HS512,
			serde_json::json!({"sub": "user-123", "exp": now + 3600}),
		),
		(Algorithm::HS256, serde_json::json!({"sub": "user-123"})),
		(
			Algorithm::HS256,
			serde_json::json!({"sub": "user-123", "exp": now + 3600, "nbf": now + 600}),
		),
	] {
		let token = encode(
			&Header::new(algorithm),
			&claims,
			&EncodingKey::from_secret(secret),
		)
		.unwrap();
		assert!(verify_token(secret, &token).is_err());
	}
}

#[test]
fn request_auth_preserves_bearer_precedence_and_configured_cookie_name() {
	use axum::http::{HeaderMap, HeaderValue};
	use slidesage_backend::auth::request::RequestAuth;
	let secret = b"test-secret-key-that-is-at-least-32-bytes-long";
	let token = issue_token(secret, "user-123", "", chrono::Utc::now().timestamp(), 3600).unwrap();
	let auth = RequestAuth::new(secret, "__Secure-slidesage_token");
	let mut headers = HeaderMap::new();
	headers.insert(
		"cookie",
		HeaderValue::from_str(&format!("slidesage_token={token}")).unwrap(),
	);
	assert_eq!(auth.user_id(&headers), None);
	headers.insert(
		"cookie",
		HeaderValue::from_str(&format!("__Secure-slidesage_token=\"{token}\"")).unwrap(),
	);
	assert_eq!(auth.user_id(&headers).as_deref(), Some("user-123"));
	headers.insert(
		"authorization",
		HeaderValue::from_static("Bearer bad-token"),
	);
	assert_eq!(auth.user_id(&headers), None);
	headers.insert("authorization", HeaderValue::from_static("Bearer "));
	assert_eq!(auth.user_id(&headers), None);
	headers.insert("authorization", HeaderValue::from_static("bearer ignored"));
	assert_eq!(auth.user_id(&headers).as_deref(), Some("user-123"));
	headers.remove("authorization");
	headers.insert(
		"cookie",
		HeaderValue::from_str(&format!(
			"__Secure-slidesage_token=; __Secure-slidesage_token={token}"
		))
		.unwrap(),
	);
	assert_eq!(auth.user_id(&headers), None);
}

#[test]
fn request_auth_handles_non_ascii_header_bytes_like_go() {
	use axum::http::{HeaderMap, HeaderValue};
	use slidesage_backend::auth::request::RequestAuth;
	let secret = b"test-secret-key-that-is-at-least-32-bytes-long";
	let token = issue_token(secret, "user-123", "", chrono::Utc::now().timestamp(), 3600).unwrap();
	let auth = RequestAuth::new(secret, "slidesage_token");
	let cookie = format!("slidesage_token={token}");
	let mut headers = HeaderMap::new();
	headers.insert("cookie", HeaderValue::from_str(&cookie).unwrap());
	for suffix in ["é".as_bytes(), &[0xff]] {
		headers.insert(
			"authorization",
			HeaderValue::from_bytes(&[b"Bearer ".as_slice(), suffix].concat()).unwrap(),
		);
		assert_eq!(
			auth.user_id(&headers),
			None,
			"invalid bearer must block the valid cookie"
		);
		headers.remove("authorization");
		for prefix in [b"other=".as_slice(), b"slidesage_token=".as_slice()] {
			headers.insert(
				"cookie",
				HeaderValue::from_bytes(&[prefix, suffix, b"; ", cookie.as_bytes()].concat())
					.unwrap(),
			);
			assert_eq!(
				auth.user_id(&headers).as_deref(),
				Some("user-123"),
				"a malformed cookie must not hide a valid cookie"
			);
		}
		headers.insert("cookie", HeaderValue::from_str(&cookie).unwrap());
	}
}
