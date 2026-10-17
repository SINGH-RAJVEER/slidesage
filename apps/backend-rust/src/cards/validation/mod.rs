//! Native card-document validation, preserving the TypeScript validator's issue order.
pub mod json;
mod layouts;
mod nodes;

use json::{Object, Text, Value};
use serde::Serialize;
use std::collections::HashSet;

type Result<T> = std::result::Result<T, Issue>;
#[derive(Debug, Serialize)]
pub struct Issue {
	pub path: Text,
	pub message: Text,
}
fn fail<T>(path: &Text, message: impl AsRef<str>) -> Result<T> {
	Err(Issue {
		path: path.clone(),
		message: Text::new(message.as_ref()),
	})
}
fn record(value: &Value, path: &Text, keys: &[&str]) -> Result<Object> {
	let Some(raw) = value.record() else {
		return fail(path, "must be an object");
	};
	for (key, _) in &raw.0 {
		if !keys.iter().any(|allowed| key.is(allowed)) {
			return fail(&path.child_text(key), "is not a known field");
		}
	}
	Ok(raw)
}
fn array(value: &Value, path: &Text) -> Result<Vec<Value>> {
	value.array().ok_or_else(|| Issue {
		path: path.clone(),
		message: Text::new("must be an array"),
	})
}
fn text(value: &Value, path: &Text, maximum: usize) -> Result<Value> {
	let Some(value) = value.string() else {
		return fail(path, "must be a string");
	};
	if value.blank() {
		return fail(path, "must not be empty");
	}
	if value.length() > maximum {
		return fail(
			path,
			format!("is {} characters, the limit is {maximum}", value.length()),
		);
	}
	Ok(Value::String(value))
}
fn one_of(value: &Value, path: &Text, allowed: &[&str]) -> Result<Value> {
	if value
		.string()
		.is_none_or(|value| !allowed.iter().any(|item| value.is(item)))
	{
		return fail(path, format!("must be one of {}", allowed.join(", ")));
	}
	Ok(Value::String(value.string().unwrap()))
}
fn id(value: &Value, path: &Text, seen: &mut HashSet<Text>) -> Result<Value> {
	let Some(value) = value.string() else {
		return fail(path, "is not a valid ID");
	};
	let bytes = &value.0;
	if !(8..=34).contains(&bytes.len())
		|| !matches!(bytes[0], 97..=122)
		|| bytes[1] != 95
		|| !bytes[2..]
			.iter()
			.all(|unit| matches!(*unit, 97..=122 | 48..=57))
	{
		return fail(path, "is not a valid ID");
	}
	if !seen.insert(value.clone()) {
		return fail(path, format!("duplicates ID {}", value.display()));
	}
	Ok(Value::String(value))
}
fn rich_text(value: &Value, path: &Text, maximum: usize) -> Result<Value> {
	let runs = array(value, path)?;
	if runs.is_empty() {
		return fail(path, "must not be empty");
	}
	let mut plain = Text(Vec::new());
	let mut result = Vec::new();
	for (index, run) in runs.iter().enumerate() {
		let p = path.index(index);
		let raw = record(run, &p, &["text", "bold", "italic"])?;
		let Some(content) = raw.get("text").string().filter(|value| !value.0.is_empty()) else {
			return fail(&p.child("text"), "must be a non-empty string");
		};
		plain.0.extend(&content.0);
		let mut fields = vec![(Text::new("text"), Value::String(content))];
		for mark in ["bold", "italic"] {
			if !raw.get(mark).undefined() {
				if raw.get(mark).boolean() != Some(true) {
					return fail(&p.child(mark), "must be true when present");
				}
				fields.push((Text::new(mark), Value::Bool(true)));
			}
		}
		result.push(Value::Object(Object(fields)));
	}
	if plain.blank() {
		return fail(path, "must not be blank");
	}
	if plain.length() > maximum {
		return fail(
			path,
			format!("is {} characters, the limit is {maximum}", plain.length()),
		);
	}
	Ok(Value::Array(result))
}
fn count(length: usize, path: &Text, min: usize, max: usize, noun: &str) -> Result<()> {
	if length < min || length > max {
		return fail(path, format!("must hold {min}-{max} {noun}, got {length}"));
	}
	Ok(())
}
fn finite(value: &Value, path: &Text, min: f64, max: f64) -> Result<Value> {
	let Some(number) = value.number().filter(|number| number.is_finite()) else {
		return fail(path, "must be a number");
	};
	if number < min || number > max {
		return fail(path, format!("must be from {min} to {max}"));
	}
	Ok(Value::Number(number))
}
const ROLES: &[&str] = &[
	"opening",
	"context",
	"evidence",
	"comparison",
	"process",
	"insight",
	"closing",
];
const LAYOUTS: &[&str] = &[
	"title",
	"statement",
	"bullets",
	"comparison",
	"process",
	"quote",
	"stats",
	"image-left",
	"image-right",
	"cover",
	"chart",
	"table",
	"dashboard",
];
const THEMES: &[&str] = &[
	"slate", "paper", "ember", "ocean", "grove", "orchid", "sand", "cobalt", "mono",
];
const SIZES: &[&str] = &["small", "medium", "large", "full"];
const KINDS: &[&str] = &[
	"column",
	"bar",
	"stacked-column",
	"line",
	"area",
	"pie",
	"donut",
];

fn card(
	value: &Value,
	path: &Text,
	seen: &mut HashSet<Text>,
	assets: &HashSet<Text>,
	known_sources: Option<&HashSet<Text>>,
) -> Result<Value> {
	let raw = record(
		value,
		path,
		&[
			"id",
			"takeaway",
			"role",
			"layout",
			"nodes",
			"sourceIds",
			"notes",
		],
	)?;
	let node_id = id(raw.get("id"), &path.child("id"), seen)?;
	let takeaway = text(raw.get("takeaway"), &path.child("takeaway"), 200)?;
	let role = one_of(raw.get("role"), &path.child("role"), ROLES)?;
	let layout = one_of(raw.get("layout"), &path.child("layout"), LAYOUTS)?;
	let mut nodes = Vec::new();
	for (index, value) in array(raw.get("nodes"), &path.child("nodes"))?
		.iter()
		.enumerate()
	{
		nodes.push(nodes::node(
			value,
			&path.child("nodes").index(index),
			seen,
			assets,
		)?);
	}
	let sources = array(raw.get("sourceIds"), &path.child("sourceIds"))?;
	if sources.len() > 8 {
		return fail(&path.child("sourceIds"), "may name at most 8 sources");
	}
	let mut unique = HashSet::new();
	let mut source_ids = Vec::new();
	for (index, source) in sources.iter().enumerate() {
		let Some(source) = source.string().filter(|value| {
			(2..=4).contains(&value.0.len())
				&& value.0[0] == 115
				&& value.0[1..].iter().all(|unit| matches!(*unit, 48..=57))
		}) else {
			return fail(&path.child("sourceIds").index(index), "is not a source ID");
		};
		if known_sources.is_some_and(|known| !known.contains(&source)) {
			return fail(
				&path.child("sourceIds").index(index),
				format!("names unknown source {}", source.display()),
			);
		}
		if unique.insert(source.clone()) {
			source_ids.push(Value::String(source));
		}
	}
	let mut fields = vec![
		(Text::new("id"), node_id),
		(Text::new("takeaway"), takeaway),
		(Text::new("role"), role),
		(Text::new("layout"), layout.clone()),
		(Text::new("nodes"), Value::Array(nodes.clone())),
		(Text::new("sourceIds"), Value::Array(source_ids)),
	];
	if !raw.get("notes").undefined() {
		fields.push((
			Text::new("notes"),
			text(raw.get("notes"), &path.child("notes"), 1200)?,
		));
	}
	if let Some(message) = layouts::mismatch(&layout.string().unwrap().display(), &nodes) {
		return Err(Issue {
			path: path.child("layout"),
			message,
		});
	}
	Ok(Value::Object(Object(fields)))
}

#[derive(Debug)]
pub enum Error {
	Schema(Issue),
	Conversion,
}
impl From<Issue> for Error {
	fn from(issue: Issue) -> Self {
		Self::Schema(issue)
	}
}

pub fn card_for_conversion(
	value: &Value,
	sources: &HashSet<Text>,
	assets: &HashSet<Text>,
) -> std::result::Result<Value, Error> {
	card(
		value,
		&Text::new("card"),
		&mut HashSet::new(),
		assets,
		Some(sources),
	)
	.map_err(Into::into)
}

pub fn document(value: &Value, assets: &HashSet<Text>) -> std::result::Result<Value, Error> {
	let path = Text::new("document");
	let raw = record(
		value,
		&path,
		&["schemaVersion", "title", "theme", "cardOrder", "cards"],
	)?;
	if !raw
		.get("schemaVersion")
		.number()
		.is_some_and(|v| [1., 2., 3.].contains(&v))
	{
		return fail(&path.child("schemaVersion"), "must be one of 1, 2, 3").map_err(Into::into);
	}
	let order = array(raw.get("cardOrder"), &path.child("cardOrder"))?;
	if order.is_empty() || order.len() > 40 {
		return fail(&path.child("cardOrder"), "must hold 1-40 cards").map_err(Into::into);
	}
	// Array.map(String) runs before the cards record check in TypeScript.
	// An own, non-callable toString blocks Object.prototype.toString and
	// causes the same generic conversion failure as the original handler.
	let keys = order
		.iter()
		.map(js_string)
		.collect::<Option<Vec<_>>>()
		.ok_or(Error::Conversion)?;
	let Some(cards_raw) = raw.get("cards").record() else {
		return fail(&path.child("cards"), "must be an object").map_err(Into::into);
	};
	for (key, _) in &cards_raw.0 {
		if !keys.contains(key) {
			return fail(&path.child("cards").child_text(key), "is not a known field")
				.map_err(Into::into);
		}
	}
	let mut cards = Vec::new();
	let mut seen = HashSet::new();
	let mut card_order = Vec::new();
	for (index, key) in order.iter().enumerate() {
		let Some(key) = key.string() else {
			return fail(&path.child("cardOrder").index(index), "must be a string")
				.map_err(Into::into);
		};
		if cards.iter().any(|(name, _)| name == &key)
			|| [
				"__proto__",
				"constructor",
				"toString",
				"toLocaleString",
				"valueOf",
				"hasOwnProperty",
				"isPrototypeOf",
				"propertyIsEnumerable",
				"__defineGetter__",
				"__defineSetter__",
				"__lookupGetter__",
				"__lookupSetter__",
			]
			.iter()
			.any(|name| key.is(name))
		{
			return fail(
				&path.child("cardOrder").index(index),
				format!("repeats card {}", key.display()),
			)
			.map_err(Into::into);
		}
		let p = path.child("cards").child_text(&key);
		let parsed = card(cards_raw.get_text(&key), &p, &mut seen, assets, None)?;
		if parsed.record().unwrap().get("id").string() != Some(key.clone()) {
			return fail(&p.child("id"), "does not match its key").map_err(Into::into);
		}
		cards.push((key.clone(), parsed));
		card_order.push(Value::String(key));
	}
	Ok(Value::object([
		("schemaVersion", Value::Number(3.)),
		("title", text(raw.get("title"), &path.child("title"), 120)?),
		(
			"theme",
			one_of(raw.get("theme"), &path.child("theme"), THEMES)?,
		),
		("cardOrder", Value::Array(card_order)),
		("cards", Value::Object(Object(cards))),
	]))
}
pub(crate) fn js_string(value: &Value) -> Option<Text> {
	if let Some(number) = value.number()
		&& number.is_infinite()
	{
		return Some(Text::new(if number.is_sign_positive() {
			"Infinity"
		} else {
			"-Infinity"
		}));
	}
	if let Some(text) = value.string() {
		return Some(text);
	}
	if let Some(values) = value.array() {
		let mut units = Vec::new();
		for (index, value) in values.iter().enumerate() {
			if index > 0 {
				units.push(44);
			}
			if !value.nullish() {
				units.extend(js_string(value)?.0);
			}
		}
		return Some(Text(units));
	}
	if let Some(object) = value.record() {
		return object
			.get("toString")
			.undefined()
			.then(|| Text::new("[object Object]"));
	}
	Some(Text::new(&value.stringify()))
}
