//! Document assembly using the original converter's request checks and text cleanup.

use super::validation::{
	self,
	json::{Object, Text, Value},
};
use std::collections::{HashMap, HashSet};
use unicode_normalization::UnicodeNormalization;

#[derive(Debug)]
pub enum Error {
	Request(String),
	Validation(validation::Error),
}

/// Validates request fields in JavaScript evaluation order, then normalizes cards.
pub fn assemble(input: &Object) -> Result<Value, Error> {
	let theme = input
		.get("theme")
		.string()
		.filter(|theme| {
			[
				"slate", "paper", "ember", "ocean", "grove", "orchid", "sand", "cobalt", "mono",
			]
			.iter()
			.any(|allowed| theme.is(allowed))
		})
		.ok_or_else(|| Error::Request("theme is not known".into()))?;
	let title = required_string(input.get("title"), "title")?;
	let cards = input
		.get("cards")
		.array()
		.ok_or_else(|| Error::Request("cards must be an array".into()))?;
	let mut assets = HashSet::new();
	if !input.get("assetIds").nullish() {
		let values = input
			.get("assetIds")
			.array()
			.ok_or_else(|| Error::Request("assetIds must be an array".into()))?;
		for (index, value) in values.iter().enumerate() {
			assets.insert(required_string(value, &format!("assetIds[{index}]"))?);
		}
	}
	// Array.map reads every card.id before Object.fromEntries coerces any key.
	let mut ids = Vec::with_capacity(cards.len());
	for card in &cards {
		if card.nullish() {
			return Err(Error::Validation(validation::Error::Conversion));
		}
		ids.push(
			card.record()
				.map(|raw| raw.get("id").clone())
				.unwrap_or(Value::Undefined),
		);
	}
	let mut entries: Vec<(Text, Value)> = Vec::new();
	let mut positions: HashMap<Text, usize> = HashMap::new();
	for (id, card) in ids.iter().zip(&cards) {
		let key =
			validation::js_string(id).ok_or(Error::Validation(validation::Error::Conversion))?;
		if let Some(position) = positions.get(&key).copied() {
			entries[position].1 = card.clone();
		} else {
			positions.insert(key.clone(), entries.len());
			entries.push((key, card.clone()));
		}
	}
	// Numeric own keys sort before the remaining insertion-ordered properties.
	entries.sort_by_key(|(key, _)| {
		let text = key.display();
		text.parse::<u32>()
			.ok()
			.filter(|index| *index != u32::MAX && index.to_string() == text)
			.unwrap_or(u32::MAX)
	});
	let document = Value::object([
		("schemaVersion", Value::Number(3.)),
		("title", Value::String(clean_text(&title))),
		("theme", Value::String(theme)),
		("cardOrder", Value::Array(ids)),
		("cards", Value::Object(Object(entries))),
	]);
	validation::document(&document, &assets).map_err(Error::Validation)
}

fn required_string(value: &Value, field: &str) -> Result<Text, Error> {
	value
		.string()
		.filter(|text| !text.blank())
		.ok_or_else(|| Error::Request(format!("{field} must be a non-empty string")))
}

/// NFC normalization preserves unpaired UTF-16 units, as String.normalize does.
pub fn clean_text(value: &Text) -> Text {
	let mut normalized = Vec::new();
	let mut span = String::new();
	for decoded in char::decode_utf16(value.0.iter().copied()) {
		match decoded {
			Ok(ch) => span.push(ch),
			Err(error) => {
				normalized.extend(span.nfc().collect::<String>().encode_utf16());
				span.clear();
				normalized.push(error.unpaired_surrogate());
			}
		}
	}
	normalized.extend(span.nfc().collect::<String>().encode_utf16());
	let mut cleaned = Vec::new();
	let mut offset = 0;
	let mut pending_space = false;
	while offset < normalized.len() {
		if normalized[offset] == b'<' as u16
			&& let Some(end) = tag_end(&normalized, offset)
		{
			offset = end;
			continue;
		}
		let unit = normalized[offset];
		offset += 1;
		if matches!(unit, 0..=0x1f | 0x7f..=0x9f | 0x200b..=0x200f | 0x202a..=0x202e | 0x2060..=0x2069 | 0xfeff)
			|| super::validation::json::whitespace(unit)
		{
			pending_space = !cleaned.is_empty();
		} else {
			if pending_space {
				cleaned.push(b' ' as u16);
			}
			pending_space = false;
			cleaned.push(unit);
		}
	}
	Text(cleaned)
}

fn tag_end(text: &[u16], start: usize) -> Option<usize> {
	let mut offset = start + 1;
	if text.get(offset) == Some(&(b'/' as u16)) {
		offset += 1;
	}
	let beginning = offset;
	while text
		.get(offset)
		.is_some_and(|unit| matches!(*unit, 65..=90 | 97..=122 | 48..=57))
	{
		offset += 1;
	}
	let name = String::from_utf16_lossy(&text[beginning..offset]).to_ascii_lowercase();
	if ![
		"a",
		"b",
		"big",
		"blockquote",
		"br",
		"code",
		"del",
		"div",
		"em",
		"embed",
		"font",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"hr",
		"i",
		"iframe",
		"img",
		"ins",
		"li",
		"mark",
		"object",
		"ol",
		"p",
		"pre",
		"s",
		"script",
		"small",
		"span",
		"strike",
		"strong",
		"style",
		"sub",
		"sup",
		"svg",
		"table",
		"tbody",
		"td",
		"th",
		"thead",
		"tr",
		"u",
		"ul",
	]
	.contains(&name.as_str())
	{
		return None;
	}
	loop {
		let before_space = offset;
		while text
			.get(offset)
			.is_some_and(|unit| super::validation::json::whitespace(*unit))
		{
			offset += 1;
		}
		if text.get(offset) == Some(&(b'>' as u16)) {
			return Some(offset + 1);
		}
		if text.get(offset) == Some(&(b'/' as u16)) && text.get(offset + 1) == Some(&(b'>' as u16))
		{
			return Some(offset + 2);
		}
		if offset == before_space {
			return None;
		}
		let attribute = offset;
		while text
			.get(offset)
			.is_some_and(|unit| matches!(*unit, 65..=90 | 97..=122 | 48..=57 | 95 | 58 | 45))
		{
			offset += 1;
		}
		if attribute == offset {
			return None;
		}
		while text
			.get(offset)
			.is_some_and(|unit| super::validation::json::whitespace(*unit))
		{
			offset += 1;
		}
		if text.get(offset) != Some(&(b'=' as u16)) {
			return None;
		}
		offset += 1;
		while text
			.get(offset)
			.is_some_and(|unit| super::validation::json::whitespace(*unit))
		{
			offset += 1;
		}
		match text.get(offset).copied()? {
			quote @ (34 | 39) => {
				offset += 1;
				while text.get(offset).is_some_and(|unit| *unit != quote) {
					offset += 1;
				}
				text.get(offset)?;
				offset += 1;
			}
			_ => {
				let value = offset;
				while text.get(offset).is_some_and(|unit| {
					!super::validation::json::whitespace(*unit)
						&& !matches!(*unit, 34 | 39 | 60 | 62 | 61 | 96)
				}) {
					offset += 1;
				}
				if offset == value {
					return None;
				}
			}
		}
	}
}
