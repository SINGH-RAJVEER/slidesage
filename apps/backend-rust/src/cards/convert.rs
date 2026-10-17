//! Native conversion of independent model drafts into validated cards.

use super::{
	assembly::clean_text,
	validation::{
		self,
		json::{Object, Text, Value},
	},
};
use std::collections::HashSet;

#[derive(Debug)]
pub enum Error {
	Request(String),
	Validation(validation::Error),
}

type DraftResult<T> = Result<T, validation::Error>;

fn issue<T>(path: &str, message: impl AsRef<str>) -> DraftResult<T> {
	Err(validation::Error::Schema(validation::Issue {
		path: Text::new(path),
		message: Text::new(message.as_ref()),
	}))
}

fn required(value: &Value, field: &str) -> Result<Text, Error> {
	value
		.string()
		.filter(|value| !value.blank())
		.ok_or_else(|| Error::Request(format!("{field} must be a non-empty string")))
}

fn string_list(value: &Value, field: &str) -> Result<HashSet<Text>, Error> {
	if value.nullish() {
		return Ok(HashSet::new());
	}
	let list = value
		.array()
		.ok_or_else(|| Error::Request(format!("{field} must be an array")))?;
	list.iter()
		.enumerate()
		.map(|(index, value)| required(value, &format!("{field}[{index}]")))
		.collect()
}

/// Checks request fields before converting each card, matching the original handler.
pub fn convert(input: &Object) -> Result<Value, Error> {
	let operation = required(input.get("operationId"), "operationId")?;
	let sources = string_list(input.get("sourceIds"), "sourceIds")?;
	let assets = string_list(input.get("assetIds"), "assetIds")?;
	let cards = input
		.get("cards")
		.array()
		.ok_or_else(|| Error::Request("cards must be an array".into()))?;
	let mut checked = Vec::with_capacity(cards.len());
	for (index, value) in cards.iter().enumerate() {
		// Arrays satisfy typeof value === "object" and fail the position check.
		if value.record().is_none() && value.array().is_none() {
			return Err(Error::Request(format!("cards[{index}] must be an object")));
		}
		let raw = value.record().unwrap_or(Object(Vec::new()));
		let position = raw
			.get("position")
			.number()
			.filter(|number| number.is_finite() && number.fract() == 0. && *number >= 1.)
			.ok_or_else(|| {
				Error::Request(format!(
					"cards[{index}].position must be a positive integer"
				))
			})?;
		let role = raw
			.get("role")
			.string()
			.filter(|role| {
				[
					"opening",
					"context",
					"evidence",
					"comparison",
					"process",
					"insight",
					"closing",
				]
				.iter()
				.any(|allowed| role.is(allowed))
			})
			.ok_or_else(|| {
				Error::Request(format!("cards[{index}].role is not a narrative role"))
			})?;
		let takeaway = required(raw.get("takeaway"), &format!("cards[{index}].takeaway"))?;
		checked.push((position, role, takeaway, raw.get("draft").clone()));
	}
	let mut results = Vec::with_capacity(checked.len());
	for (position, role, takeaway, draft) in checked {
		let mut reader = Reader {
			operation: &operation,
			position,
			counter: 0,
		};
		let result = reader.card(&draft, role, takeaway, &sources, &assets);
		let payload = match result {
			Ok(card) => ("card", card),
			Err(validation::Error::Schema(issue)) => (
				"issue",
				Value::object([
					("path", Value::String(issue.path)),
					("message", Value::String(issue.message)),
				]),
			),
			Err(error) => return Err(Error::Validation(error)),
		};
		results.push(Value::object([
			("position", Value::Number(position)),
			payload,
		]));
	}
	Ok(Value::object([
		("schemaVersion", Value::Number(3.)),
		("results", Value::Array(results)),
	]))
}

/// cyrb53 consumes UTF-16 code units and uses wrapping 32-bit multiplication.
pub fn hash(value: &Text) -> String {
	let mut first = 0xdeadbeefu32;
	let mut second = 0x41c6ce57u32;
	for unit in &value.0 {
		first = (first ^ u32::from(*unit)).wrapping_mul(2654435761);
		second = (second ^ u32::from(*unit)).wrapping_mul(1597334677);
	}
	first = (first ^ (first >> 16)).wrapping_mul(2246822507)
		^ (second ^ (second >> 13)).wrapping_mul(3266489909);
	second = (second ^ (second >> 16)).wrapping_mul(2246822507)
		^ (first ^ (first >> 13)).wrapping_mul(3266489909);
	let mut number = (u64::from(second & 2097151) << 32) + u64::from(first);
	let mut digits = Vec::new();
	loop {
		digits.push(b"0123456789abcdefghijklmnopqrstuvwxyz"[(number % 36) as usize] as char);
		number /= 36;
		if number == 0 {
			break;
		}
	}
	while digits.len() < 8 {
		digits.push('0');
	}
	digits.into_iter().rev().collect()
}

pub fn clean_affix(value: &Text, suffix: bool) -> Text {
	let mut text = clean_text(value);
	if text.0.is_empty() {
		return text;
	}
	if suffix
		&& value
			.0
			.first()
			.is_some_and(|unit| validation::json::whitespace(*unit))
	{
		text.0.insert(0, 32);
	} else if !suffix
		&& value
			.0
			.last()
			.is_some_and(|unit| validation::json::whitespace(*unit))
	{
		text.0.push(32);
	}
	text
}

/// Splits the original emphasis expression over UTF-16 without changing stray stars.
pub fn inline_markup(value: &Text) -> Value {
	let text = clean_text(value).0;
	let mut runs = Vec::new();
	let mut cursor = 0;
	let mut plain = 0;
	while cursor < text.len() {
		if text[cursor] != 42 {
			cursor += 1;
			continue;
		}
		let matched = if text.get(cursor + 1) == Some(&42) {
			let start = cursor + 2;
			let end = (start..text.len()).find(|index| text[*index] == 42);
			end.filter(|end| *end > start && text.get(*end + 1) == Some(&42))
				.map(|end| (start, end, end + 2, "bold"))
		} else {
			None
		}
		.or_else(|| {
			let start = cursor + 1;
			if text
				.get(start)
				.is_none_or(|unit| *unit == 42 || validation::json::whitespace(*unit))
			{
				return None;
			}
			(start..text.len())
				.find(|index| text[*index] == 42)
				.map(|end| (start, end, end + 1, "italic"))
		});
		if let Some((start, end, after, mark)) = matched {
			if plain < cursor {
				runs.push(text_run(&text[plain..cursor]));
			}
			runs.push(Value::object([
				("text", Value::String(Text(text[start..end].to_vec()))),
				(mark, Value::Bool(true)),
			]));
			cursor = after;
			plain = after;
		} else {
			cursor += 1;
		}
	}
	if plain < text.len() {
		runs.push(text_run(&text[plain..]));
	}
	Value::Array(runs)
}

// The original parser classifies every split part, including unmatched parts.
fn text_run(part: &[u16]) -> Value {
	let (text, mark) = if part.len() > 4 && part.starts_with(&[42, 42]) && part.ends_with(&[42, 42])
	{
		(&part[2..part.len() - 2], Some("bold"))
	} else if part.len() > 2 && part.first() == Some(&42) && part.last() == Some(&42) {
		(&part[1..part.len() - 1], Some("italic"))
	} else {
		(part, None)
	};
	let mut fields = vec![(Text::new("text"), Value::String(Text(text.to_vec())))];
	if let Some(mark) = mark {
		fields.push((Text::new(mark), Value::Bool(true)));
	}
	Value::Object(Object(fields))
}

struct Reader<'a> {
	operation: &'a Text,
	position: f64,
	counter: u64,
}
impl Reader<'_> {
	fn id(&mut self, prefix: &str) -> Value {
		self.counter += 1;
		let mut input = self.operation.0.clone();
		input.extend(
			format!(
				":{}:{}",
				Value::Number(self.position).stringify(),
				self.counter
			)
			.encode_utf16(),
		);
		Value::text(&format!("{prefix}_{}", hash(&Text(input))))
	}
	fn object(&self, value: &Value, path: &str) -> DraftResult<Object> {
		value.record().ok_or_else(|| {
			validation::Error::Schema(validation::Issue {
				path: Text::new(path),
				message: Text::new("must be an object"),
			})
		})
	}
	fn list(&self, value: &Value, path: &str) -> DraftResult<Vec<Value>> {
		value.array().ok_or_else(|| {
			validation::Error::Schema(validation::Issue {
				path: Text::new(path),
				message: Text::new("must be an array"),
			})
		})
	}
	fn string(&self, value: &Value, path: &str) -> DraftResult<Value> {
		match value.string() {
			Some(value) => Ok(Value::String(clean_text(&value))),
			None => issue(path, "must be a string"),
		}
	}
	fn rich(&self, value: &Value, path: &str) -> DraftResult<Value> {
		match value.string() {
			Some(value) => Ok(inline_markup(&value)),
			None => issue(path, "must be a string"),
		}
	}
	fn number(&self, value: &Value, path: &str) -> DraftResult<Value> {
		let Some(text) = value.string() else {
			return Ok(value.clone());
		};
		let units: Vec<_> = text
			.0
			.into_iter()
			.filter(|unit| *unit != 44 && !validation::json::whitespace(*unit))
			.collect();
		let mut position = usize::from(units.first() == Some(&45));
		let integer = position;
		while units
			.get(position)
			.is_some_and(|unit| matches!(*unit, 48..=57))
		{
			position += 1;
		}
		if position == integer {
			return issue(path, "must be a number without units");
		}
		if units.get(position) == Some(&46) {
			position += 1;
			let decimal = position;
			while units
				.get(position)
				.is_some_and(|unit| matches!(*unit, 48..=57))
			{
				position += 1;
			}
			if decimal == position {
				return issue(path, "must be a number without units");
			}
		}
		if position != units.len() {
			return issue(path, "must be a number without units");
		}
		Ok(Value::Number(
			String::from_utf16_lossy(&units)
				.parse()
				.expect("numeric grammar checked"),
		))
	}
	fn optional(&self, raw: &Object, field: &'static str, node: &mut Object) {
		if let Some(text) = raw.get(field).string() {
			let text = clean_text(&text);
			if !text.0.is_empty() {
				node.0.push((Text::new(field), Value::String(text)));
			}
		}
	}
	fn items(&mut self, value: &Value, path: &str) -> DraftResult<Value> {
		let mut items = Vec::new();
		for (index, item) in self.list(value, path)?.iter().enumerate() {
			let id = self.id("i");
			items.push(Value::object([
				("id", id),
				("text", self.rich(item, &format!("{path}[{index}]"))?),
			]));
		}
		Ok(Value::Array(items))
	}
	fn node(&mut self, value: &Value, path: &str) -> DraftResult<Value> {
		let raw = self.object(value, path)?;
		let kind = raw.get("type").string();
		let supported = [
			"heading",
			"paragraph",
			"bullets",
			"quote",
			"stat",
			"steps",
			"columns",
			"image",
			"chart",
			"progress",
			"table",
			"callout",
		];
		if kind
			.as_ref()
			.is_none_or(|kind| !supported.iter().any(|item| kind.is(item)))
		{
			return issue(
				&format!("{path}.type"),
				format!(
					"unsupported node type {}; use heading, paragraph, bullets, quote, stat, steps, columns, chart, progress, table, or callout",
					raw.get("type").stringify()
				),
			);
		}
		let kind = kind.unwrap();
		let name = kind.display();
		let mut fields = vec![
			(Text::new("id"), self.id("n")),
			(Text::new("type"), Value::String(kind)),
		];
		macro_rules! push {
			($key:literal, $value:expr) => {
				fields.push((Text::new($key), $value))
			};
		}
		match name.as_str() {
			"heading" | "paragraph" | "quote" => {
				push!("text", self.rich(raw.get("text"), &format!("{path}.text"))?);
				if name == "quote"
					&& let Some(text) = raw.get("attribution").string()
				{
					let text = clean_text(&text);
					if !text.0.is_empty() {
						push!("attribution", Value::String(text));
					}
				}
			}
			"bullets" => push!(
				"items",
				self.items(raw.get("items"), &format!("{path}.items"))?
			),
			"stat" => {
				push!(
					"value",
					self.string(raw.get("value"), &format!("{path}.value"))?
				);
				push!(
					"label",
					self.string(raw.get("label"), &format!("{path}.label"))?
				);
			}
			"steps" | "columns" | "progress" => {
				if name == "progress" {
					push!("size", raw.get("size").clone());
				}
				let key = if name == "columns" {
					"columns"
				} else {
					"items"
				};
				let mut items = Vec::new();
				for (index, value) in self
					.list(raw.get(key), &format!("{path}.{key}"))?
					.iter()
					.enumerate()
				{
					let p = format!("{path}.{key}[{index}]");
					let item = self.object(value, &p)?;
					let id = self.id("i");
					let result = if name == "steps" {
						let mut result = Object(vec![
							(Text::new("id"), id),
							(
								Text::new("title"),
								self.string(item.get("title"), &format!("{p}.title"))?,
							),
						]);
						if item
							.get("detail")
							.string()
							.is_some_and(|text| !clean_text(&text).0.is_empty())
						{
							result.0.push((
								Text::new("detail"),
								self.rich(item.get("detail"), &format!("{p}.detail"))?,
							));
						}
						Value::Object(result)
					} else if name == "columns" {
						let heading = self.string(item.get("heading"), &format!("{p}.heading"))?;
						Value::object([
							("id", id),
							("heading", heading),
							(
								"items",
								self.items(item.get("items"), &format!("{p}.items"))?,
							),
						])
					} else {
						Value::object([
							("id", id),
							(
								"label",
								self.string(item.get("label"), &format!("{p}.label"))?,
							),
							(
								"value",
								self.number(item.get("value"), &format!("{p}.value"))?,
							),
						])
					};
					items.push(result);
				}
				fields.push((Text::new(key), Value::Array(items)));
			}
			"image" => {
				push!("assetId", raw.get("assetId").clone());
				push!(
					"alt",
					match raw.get("alt").string() {
						Some(text) => Value::String(clean_text(&text)),
						None => raw.get("alt").clone(),
					}
				);
				push!(
					"fit",
					if raw.get("fit").nullish() {
						Value::text("cover")
					} else {
						raw.get("fit").clone()
					}
				);
				if !raw.get("focus").undefined() {
					push!("focus", raw.get("focus").clone());
				}
			}
			"chart" => {
				push!("kind", raw.get("kind").clone());
				push!("size", raw.get("size").clone());
				let mut categories = Vec::new();
				for (index, value) in self
					.list(raw.get("categories"), &format!("{path}.categories"))?
					.iter()
					.enumerate()
				{
					categories.push(if value.number().is_some() {
						Value::String(validation::js_string(value).unwrap())
					} else {
						self.string(value, &format!("{path}.categories[{index}]"))?
					});
				}
				push!("categories", Value::Array(categories));
				let mut series = Vec::new();
				for (index, value) in self
					.list(raw.get("series"), &format!("{path}.series"))?
					.iter()
					.enumerate()
				{
					let p = format!("{path}.series[{index}]");
					let raw_series = self.object(value, &p)?;
					let id = self.id("i");
					let name = self.string(raw_series.get("name"), &format!("{p}.name"))?;
					let values = self
						.list(raw_series.get("values"), &format!("{p}.values"))?
						.iter()
						.enumerate()
						.map(|(index, value)| self.number(value, &format!("{p}.values[{index}]")))
						.collect::<DraftResult<Vec<_>>>()?;
					series.push(Value::object([
						("id", id),
						("name", name),
						("values", Value::Array(values)),
					]));
				}
				push!("series", Value::Array(series));
				for side in ["prefix", "suffix"] {
					if let Some(text) = raw.get(side).string() {
						let text = clean_affix(&text, side == "suffix");
						if !text.0.is_empty() {
							fields.push((Text::new(side), Value::String(text)));
						}
					}
				}
				let mut node = Object(fields);
				self.optional(&raw, "caption", &mut node);
				return Ok(Value::Object(node));
			}
			"table" => {
				push!("size", raw.get("size").clone());
				let columns = self
					.list(raw.get("columns"), &format!("{path}.columns"))?
					.iter()
					.enumerate()
					.map(|(index, value)| self.string(value, &format!("{path}.columns[{index}]")))
					.collect::<DraftResult<Vec<_>>>()?;
				push!("columns", Value::Array(columns));
				let mut rows = Vec::new();
				for (index, value) in self
					.list(raw.get("rows"), &format!("{path}.rows"))?
					.iter()
					.enumerate()
				{
					let id = self.id("i");
					let cells = self
						.list(value, &format!("{path}.rows[{index}]"))?
						.iter()
						.enumerate()
						.map(|(cell_index, value)| {
							if value.number().is_some() {
								Ok(Value::String(validation::js_string(value).unwrap()))
							} else {
								self.string(value, &format!("{path}.rows[{index}][{cell_index}]"))
							}
						})
						.collect::<DraftResult<Vec<_>>>()?;
					rows.push(Value::object([("id", id), ("cells", Value::Array(cells))]));
				}
				push!("rows", Value::Array(rows));
			}
			"callout" => {
				push!("size", raw.get("size").clone());
				push!(
					"tone",
					if raw.get("tone").nullish() {
						Value::text("note")
					} else {
						raw.get("tone").clone()
					}
				);
				push!("text", self.rich(raw.get("text"), &format!("{path}.text"))?);
			}
			_ => unreachable!(),
		}
		Ok(Value::Object(Object(fields)))
	}
	fn card(
		&mut self,
		value: &Value,
		role: Text,
		takeaway: Text,
		sources: &HashSet<Text>,
		assets: &HashSet<Text>,
	) -> DraftResult<Value> {
		let draft = self.object(value, "card")?;
		let mut key = self.operation.0.clone();
		key.extend(format!(":card:{}", Value::Number(self.position).stringify()).encode_utf16());
		let mut nodes = self
			.list(draft.get("nodes"), "card.nodes")?
			.iter()
			.enumerate()
			.map(|(index, node)| self.node(node, &format!("card.nodes[{index}]")))
			.collect::<DraftResult<Vec<_>>>()?;
		let has_text = nodes.iter().any(|node| {
			node.record().is_some_and(|node| {
				node.get("type").string().is_some_and(|kind| {
					["paragraph", "bullets", "callout"]
						.iter()
						.any(|text| kind.is(text))
				})
			})
		});
		for node in &mut nodes {
			let Value::Object(raw) = node else {
				unreachable!()
			};
			let kind = raw.get("type").string().unwrap();
			if !["chart", "progress", "table", "callout"]
				.iter()
				.any(|widget| kind.is(widget))
				|| !raw.get("size").undefined()
			{
				continue;
			}
			let feature = draft
				.get("layout")
				.string()
				.is_some_and(|layout| layout == kind && (layout.is("chart") || layout.is("table")));
			let size = if feature {
				if has_text { "large" } else { "full" }
			} else {
				"medium"
			};
			if let Some((_, value)) = raw.0.iter_mut().find(|(key, _)| key.is("size")) {
				*value = Value::text(size);
			}
		}
		let mut candidate = Object(vec![
			(
				Text::new("id"),
				Value::text(&format!("c_{}", hash(&Text(key)))),
			),
			(Text::new("takeaway"), Value::String(clean_text(&takeaway))),
			(Text::new("role"), Value::String(role)),
			(Text::new("layout"), draft.get("layout").clone()),
			(Text::new("nodes"), Value::Array(nodes)),
			(
				Text::new("sourceIds"),
				Value::Array(draft.get("sourceIds").array().unwrap_or_default()),
			),
		]);
		self.optional(&draft, "notes", &mut candidate);
		validation::card_for_conversion(&Value::Object(candidate), sources, assets)
	}
}
