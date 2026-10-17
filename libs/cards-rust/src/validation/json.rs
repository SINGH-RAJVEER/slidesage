//! JSON.parse values with UTF-16 strings and JavaScript object key ordering.
//! Children remain raw until validation visits them, including deeply nested
//! values in fields the schema rejects without traversing.

use serde::{Serialize, Serializer};
use serde_json::value::RawValue;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Text(pub Vec<u16>);

impl Text {
	pub fn new(value: &str) -> Self {
		Self(value.encode_utf16().collect())
	}
	pub fn is(&self, value: &str) -> bool {
		self.0.iter().copied().eq(value.encode_utf16())
	}
	pub fn display(&self) -> String {
		String::from_utf16_lossy(&self.0)
	}
	pub fn child(&self, value: &str) -> Self {
		self.child_text(&Self::new(value))
	}
	pub fn child_text(&self, value: &Self) -> Self {
		let mut next = self.0.clone();
		next.push(b'.' as u16);
		next.extend(&value.0);
		Self(next)
	}
	pub fn index(&self, value: usize) -> Self {
		let mut next = self.0.clone();
		next.extend(format!("[{value}]").encode_utf16());
		Self(next)
	}
	pub fn blank(&self) -> bool {
		self.0.iter().all(|unit| whitespace(*unit))
	}
	pub fn length(&self) -> usize {
		char::decode_utf16(self.0.iter().copied()).count()
	}
	pub fn json(&self) -> String {
		let mut result = String::from("\"");
		for decoded in char::decode_utf16(self.0.iter().copied()) {
			match decoded {
				Err(error) => result.push_str(&format!("\\u{:04x}", error.unpaired_surrogate())),
				Ok('"') => result.push_str("\\\""),
				Ok('\\') => result.push_str("\\\\"),
				Ok('\n') => result.push_str("\\n"),
				Ok('\r') => result.push_str("\\r"),
				Ok('\t') => result.push_str("\\t"),
				Ok('\u{8}') => result.push_str("\\b"),
				Ok('\u{c}') => result.push_str("\\f"),
				Ok(ch) if ch < '\u{20}' => result.push_str(&format!("\\u{:04x}", ch as u32)),
				Ok(ch) => result.push(ch),
			}
		}
		result.push('"');
		result
	}
}

pub fn whitespace(unit: u16) -> bool {
	matches!(unit, 0x9..=0xd | 0x20 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}

impl Serialize for Text {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		RawValue::from_string(self.json())
			.expect("encoded UTF-16 string is JSON")
			.serialize(serializer)
	}
}

#[derive(Clone, Debug)]
pub enum Value {
	Undefined,
	Null,
	Bool(bool),
	Number(f64),
	String(Text),
	Array(Vec<Value>),
	Object(Object),
	Raw(Box<RawValue>),
}

#[derive(Clone, Debug)]
pub struct Object(pub Vec<(Text, Value)>);

impl Object {
	pub fn get(&self, key: &str) -> &Value {
		self.0
			.iter()
			.find(|(name, _)| name.is(key))
			.map(|(_, value)| value)
			.unwrap_or(&Value::Undefined)
	}
	pub fn get_text(&self, key: &Text) -> &Value {
		self.0
			.iter()
			.find(|(name, _)| name == key)
			.map(|(_, value)| value)
			.unwrap_or(&Value::Undefined)
	}
}

impl Value {
	pub fn parse(raw: Box<RawValue>) -> Self {
		Self::Raw(raw)
	}
	pub fn text(value: &str) -> Self {
		Self::String(Text::new(value))
	}
	pub fn object(fields: impl IntoIterator<Item = (&'static str, Self)>) -> Self {
		Self::Object(Object(
			fields
				.into_iter()
				.map(|(key, value)| (Text::new(key), value))
				.collect(),
		))
	}
	pub fn string(&self) -> Option<Text> {
		match self.expanded() {
			Self::String(value) => Some(value),
			_ => None,
		}
	}
	pub fn number(&self) -> Option<f64> {
		match self.expanded() {
			Self::Number(value) => Some(value),
			_ => None,
		}
	}
	pub fn boolean(&self) -> Option<bool> {
		match self.expanded() {
			Self::Bool(value) => Some(value),
			_ => None,
		}
	}
	pub fn array(&self) -> Option<Vec<Self>> {
		match self.expanded() {
			Self::Array(value) => Some(value),
			_ => None,
		}
	}
	pub fn record(&self) -> Option<Object> {
		match self.expanded() {
			Self::Object(value) => Some(value),
			_ => None,
		}
	}
	pub fn nullish(&self) -> bool {
		matches!(self.expanded(), Self::Undefined | Self::Null)
	}
	pub fn undefined(&self) -> bool {
		matches!(self, Self::Undefined)
	}
	pub fn stringify(&self) -> String {
		match self.expanded() {
			Self::Undefined => "undefined".into(),
			Self::Null => "null".into(),
			Self::Bool(value) => value.to_string(),
			Self::Number(value) if !value.is_finite() => "null".into(),
			Self::Number(value) => number_string(value),
			Self::String(value) => value.json(),
			Self::Array(values) => format!(
				"[{}]",
				values
					.iter()
					.map(Self::stringify)
					.collect::<Vec<_>>()
					.join(",")
			),
			Self::Object(value) => format!(
				"{{{}}}",
				value
					.0
					.iter()
					.map(|(key, value)| format!("{}:{}", key.json(), value.stringify()))
					.collect::<Vec<_>>()
					.join(",")
			),
			Self::Raw(_) => unreachable!(),
		}
	}
	fn expanded(&self) -> Self {
		let Self::Raw(raw) = self else {
			return self.clone();
		};
		let text = raw.get();
		match text.as_bytes()[0] {
			b'n' => Self::Null,
			b't' => Self::Bool(true),
			b'f' => Self::Bool(false),
			b'"' => Self::String(read_string(text).0),
			b'[' => {
				let mut remaining = &text[1..];
				let mut values = Vec::new();
				loop {
					remaining = remaining.trim_start();
					if remaining.starts_with(']') {
						break;
					}
					let (value, used) = raw_prefix(remaining);
					values.push(Self::Raw(value));
					remaining = remaining[used..].trim_start();
					if remaining.starts_with(',') {
						remaining = &remaining[1..];
					}
				}
				Self::Array(values)
			}
			b'{' => {
				let mut remaining = &text[1..];
				let mut fields: Vec<(Text, Self)> = Vec::new();
				loop {
					remaining = remaining.trim_start();
					if remaining.starts_with('}') {
						break;
					}
					let (key, used) = read_string(remaining);
					remaining = remaining[used..].trim_start();
					let (value, used) = raw_prefix(remaining[1..].trim_start());
					remaining = remaining[1..].trim_start();
					remaining = remaining[used..].trim_start();
					if let Some((_, existing)) = fields.iter_mut().find(|(name, _)| name == &key) {
						*existing = Self::Raw(value);
					} else {
						fields.push((key, Self::Raw(value)));
					}
					if remaining.starts_with(',') {
						remaining = &remaining[1..];
					}
				}
				fields.sort_by_key(|(key, _)| array_index(key).unwrap_or(u32::MAX));
				Self::Object(Object(fields))
			}
			_ => Self::Number(text.parse().expect("validated JSON number parses as f64")),
		}
	}
}

fn array_index(value: &Text) -> Option<u32> {
	let text = value.display();
	let index: u32 = text.parse().ok()?;
	(index != u32::MAX && index.to_string() == text).then_some(index)
}

fn raw_prefix(input: &str) -> (Box<RawValue>, usize) {
	let mut decoder = serde_json::Deserializer::from_str(input).into_iter::<Box<RawValue>>();
	let value = decoder
		.next()
		.expect("value follows key or array opening")
		.expect("outer JSON was validated");
	(value, decoder.byte_offset())
}

fn read_string(input: &str) -> (Text, usize) {
	let bytes = input.as_bytes();
	let mut units = Vec::new();
	let mut position = 1;
	while bytes[position] != b'"' {
		if bytes[position] == b'\\' {
			position += 1;
			let unit = match bytes[position] {
				b'u' => {
					let value =
						u16::from_str_radix(&input[position + 1..position + 5], 16).unwrap();
					position += 4;
					value
				}
				b'b' => 8,
				b'f' => 12,
				b'n' => 10,
				b'r' => 13,
				b't' => 9,
				value => value as u16,
			};
			units.push(unit);
			position += 1;
		} else {
			let ch = input[position..].chars().next().unwrap();
			let mut pair = [0; 2];
			units.extend_from_slice(ch.encode_utf16(&mut pair));
			position += ch.len_utf8();
		}
	}
	(Text(units), position + 1)
}

impl Serialize for Value {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		RawValue::from_string(if self.undefined() {
			"null".into()
		} else {
			self.stringify()
		})
		.expect("encoded JavaScript value is JSON")
		.serialize(serializer)
	}
}

fn number_string(value: f64) -> String {
	ryu_js::Buffer::new().format(value).to_owned()
}
