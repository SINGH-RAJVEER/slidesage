//! Match Go's partial, case-insensitive struct decoding of legacy slides_data.

use serde::{
	Deserialize, Deserializer,
	de::{MapAccess, Visitor},
};
use serde_json::value::RawValue;
use std::fmt;

#[derive(Default)]
struct Fields(Vec<(String, Box<RawValue>)>);

impl<'de> Deserialize<'de> for Fields {
	fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
		struct Object;
		impl<'de> Visitor<'de> for Object {
			type Value = Fields;
			fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
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

fn fields(raw: &str) -> Vec<(String, Box<RawValue>)> {
	serde_json::from_str::<Fields>(raw).unwrap_or_default().0
}

fn matches(key: &str, field: &str) -> bool {
	key.replace('ſ', "s").eq_ignore_ascii_case(field)
}

fn sources(raw: &str, count: &mut usize) {
	if raw == "null" {
		*count = 0;
	} else if let Ok(array) = serde_json::from_str::<Vec<Box<RawValue>>>(raw) {
		*count = array.len();
	}
}

pub(super) struct Summary {
	pub slide_count: i64,
	pub status: String,
	pub has_research: bool,
}

pub(super) fn read(raw: &str) -> Summary {
	let mut slide_count = 0;
	let mut status = String::new();
	let mut normal_sources = 0;
	let mut retry_sources = 0;
	for (key, value) in fields(raw) {
		let value = value.get();
		if matches(&key, "totalSlides") {
			if let Ok(count) = serde_json::from_str::<i64>(value) {
				slide_count = count;
			}
		} else if matches(&key, "status") {
			if let Ok(text) = serde_json::from_str::<String>(value) {
				status = text;
			}
		} else if matches(&key, "sources") {
			sources(value, &mut normal_sources);
		} else if matches(&key, "failure") {
			for (key, value) in fields(value) {
				if !matches(&key, "retry") {
					continue;
				}
				for (key, value) in fields(value.get()) {
					if !matches(&key, "research_payload") {
						continue;
					}
					for (key, value) in fields(value.get()) {
						if matches(&key, "sources") {
							sources(value.get(), &mut retry_sources);
						}
					}
				}
			}
		}
	}
	let has_research = if status == "failed" {
		retry_sources > 0
	} else {
		normal_sources > 0
	};
	if status != "failed" && status != "generating" {
		status = "ready".to_owned();
	}
	Summary {
		slide_count,
		status,
		has_research,
	}
}
