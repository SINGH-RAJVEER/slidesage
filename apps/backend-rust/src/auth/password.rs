//! Compatibility with internal/auth/password.go and its Better Auth scrypt fixture.

use rand::RngCore;
use scrypt::{Params, scrypt};
use subtle::ConstantTimeEq;
use unicode_normalization::UnicodeNormalization;

/// This shape check intentionally matches Go, which does not validate the salt's hex.
pub fn is_password_hash(hash: &str) -> bool {
	let mut parts = hash.split(':');
	matches!((parts.next(), parts.next(), parts.next()),
		(Some(salt), Some(key), None) if salt.len() == 32 && key.len() == 128)
}

/// Call from a bounded blocking task when wiring password HTTP endpoints.
pub fn hash_password(password: &str) -> String {
	let mut salt = [0u8; 16];
	rand::rng().fill_bytes(&mut salt);
	let salt = hex::encode(salt);
	format!("{salt}:{}", hex::encode(derive(password, &salt)))
}

pub fn verify_password(hash: &str, password: &str) -> bool {
	if !is_password_hash(hash) {
		return false;
	}
	let (salt, expected) = hash.split_once(':').expect("checked password hash shape");
	let Ok(expected) = hex::decode(expected) else {
		return false;
	};
	derive(password, salt).as_slice().ct_eq(&expected).into()
}

fn derive(password: &str, salt: &str) -> [u8; 64] {
	let normalized: String = password.nfkc().collect();
	let params = Params::new(14, 16, 1, 64).expect("fixed scrypt parameters are valid");
	let mut output = [0u8; 64];
	// Go uses the ASCII hex salt, not the decoded random bytes.
	scrypt(normalized.as_bytes(), salt.as_bytes(), &params, &mut output)
		.expect("fixed scrypt output length is valid");
	output
}
