//! Synthetic fixture protocol for the Go oracle tests; never use with real credentials.
use serde_json::json;
use slidesage_backend::auth::{jwt, password};
use std::io::{self, Read};

fn main() {
	let mut input = String::new();
	io::stdin().read_to_string(&mut input).unwrap();
	let input: serde_json::Value = serde_json::from_str(&input).unwrap();
	let text = |name: &str| input[name].as_str().unwrap_or("");
	let output = match text("operation") {
		"hash" => json!({"hash": password::hash_password(text("password"))}),
		"verify_password" => {
			json!({"valid": password::verify_password(text("hash"), text("password"))})
		}
		"issue_token" => {
			json!({"token": jwt::issue_token(text("secret").as_bytes(), text("user_id"), text("email"), chrono::Utc::now().timestamp(), 3600).unwrap()})
		}
		"verify_token" => {
			json!({"subject": jwt::verify_token(text("secret").as_bytes(), text("token")).ok()})
		}
		_ => panic!("unknown fixture operation"),
	};
	println!("{output}");
}
