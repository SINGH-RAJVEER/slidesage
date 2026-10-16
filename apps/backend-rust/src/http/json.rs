//! Bounded decoding with Go encoding/json's single-value and Unicode behavior.
use axum::body::Body;
use http_body_util::BodyExt;
use serde::{Deserialize, de::DeserializeOwned};

pub(crate) enum ReadError {
	TooLarge,
	Invalid,
}

pub(crate) async fn decode<T: DeserializeOwned>(
	mut body: Body,
	limit: usize,
) -> Result<T, ReadError> {
	let mut bytes = Vec::new();
	while let Some(frame) = body.frame().await {
		let frame = frame.map_err(|_| ReadError::Invalid)?;
		if let Some(data) = frame.data_ref() {
			bytes.extend_from_slice(&data[..data.len().min(limit + 1 - bytes.len())]);
			if bytes.len() > limit {
				break;
			}
		}
	}
	let oversized = bytes.len() > limit;
	let prefix = &bytes[..bytes.len().min(limit)];
	let text = replace_lone_surrogates(&go_utf8(prefix));
	let mut decoder = serde_json::Deserializer::from_str(&text);
	let raw = Box::<serde_json::value::RawValue>::deserialize(&mut decoder).map_err(|error| {
		if oversized && error.is_eof() {
			ReadError::TooLarge
		} else {
			ReadError::Invalid
		}
	})?;
	// Go decodes the full first value before validating its field types.
	let input = serde_json::from_str(raw.get()).map_err(|_| ReadError::Invalid)?;
	// A limit error while looking for a second value becomes a generic 400 in Go.
	if oversized || decoder.end().is_err() {
		return Err(ReadError::Invalid);
	}
	Ok(input)
}

fn go_utf8(mut input: &[u8]) -> std::borrow::Cow<'_, str> {
	if let Ok(text) = std::str::from_utf8(input) {
		return text.into();
	}
	let mut output = String::new();
	loop {
		match std::str::from_utf8(input) {
			Ok(text) => {
				output.push_str(text);
				break;
			}
			Err(error) => {
				let (valid, invalid) = input.split_at(error.valid_up_to());
				output.push_str(std::str::from_utf8(valid).unwrap());
				// Go replaces one invalid byte at a time, including incomplete sequences.
				output.push('\u{fffd}');
				input = &invalid[1..];
			}
		}
	}
	output.into()
}

fn replace_lone_surrogates(text: &str) -> String {
	let bytes = text.as_bytes();
	let mut output = Vec::with_capacity(bytes.len());
	let mut inside = false;
	let mut i = 0;
	while i < bytes.len() {
		if inside && bytes[i] == b'\\' {
			if let Some(code) = unicode_escape(bytes, i) {
				if (0xd800..=0xdbff).contains(&code)
					&& unicode_escape(bytes, i + 6)
						.is_some_and(|next| (0xdc00..=0xdfff).contains(&next))
				{
					output.extend_from_slice(&bytes[i..i + 12]);
					i += 12;
					continue;
				}
				if (0xd800..=0xdfff).contains(&code) {
					output.extend_from_slice(b"\\ufffd");
					i += 6;
					continue;
				}
			}
			let end = (i + 2).min(bytes.len());
			output.extend_from_slice(&bytes[i..end]);
			i = end;
			continue;
		}
		if bytes[i] == b'"' {
			inside = !inside;
		}
		output.push(bytes[i]);
		i += 1;
	}
	String::from_utf8(output).expect("only ASCII escapes were replaced in valid UTF-8")
}

fn unicode_escape(bytes: &[u8], start: usize) -> Option<u16> {
	let escape = bytes.get(start..start + 6)?;
	if &escape[..2] != b"\\u" {
		return None;
	}
	u16::from_str_radix(std::str::from_utf8(&escape[2..]).ok()?, 16).ok()
}
