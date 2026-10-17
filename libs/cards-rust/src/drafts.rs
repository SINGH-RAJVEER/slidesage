//! The validated card document in the model's existing draft format.

use super::validation::json::{Object, Text, Value};

/// IDs and images are omitted from drafts; the caller retains the stored images.
pub fn from_document(document: &Value) -> Value {
	let document = document.record().expect("document was validated");
	let cards = document.get("cards").record().unwrap();
	let drafts = document
		.get("cardOrder")
		.array()
		.unwrap()
		.into_iter()
		.map(|id| {
			let id = id.string().unwrap();
			let card = cards.get_text(&id).record().unwrap();
			let nodes = card
				.get("nodes")
				.array()
				.unwrap()
				.iter()
				.filter_map(node)
				.collect();
			let mut draft = vec![
				(Text::new("takeaway"), card.get("takeaway").clone()),
				(Text::new("layout"), card.get("layout").clone()),
				(Text::new("nodes"), Value::Array(nodes)),
				(Text::new("sourceIds"), card.get("sourceIds").clone()),
			];
			copy_optional(&mut draft, &card, "notes");
			(id, Value::Object(Object(draft)))
		})
		.collect();
	Value::Object(Object(drafts))
}

fn markup(value: &Value) -> Value {
	let mut output = Vec::new();
	for run in value.array().unwrap() {
		let run = run.record().unwrap();
		let mark = if run.get("bold").boolean() == Some(true) {
			"**"
		} else if run.get("italic").boolean() == Some(true) {
			"*"
		} else {
			""
		};
		output.extend(mark.encode_utf16());
		output.extend(run.get("text").string().unwrap().0);
		output.extend(mark.encode_utf16());
	}
	Value::String(Text(output))
}

fn copy_optional(fields: &mut Vec<(Text, Value)>, object: &Object, name: &str) {
	if !object.get(name).undefined() {
		fields.push((Text::new(name), object.get(name).clone()));
	}
}

fn node(value: &Value) -> Option<Value> {
	let raw = value.record().unwrap();
	let kind = raw.get("type").string().unwrap().display();
	let mut fields = vec![(Text::new("type"), raw.get("type").clone())];
	match kind.as_str() {
		"image" => return None,
		"heading" | "paragraph" | "quote" | "callout" => {
			fields.push((Text::new("text"), markup(raw.get("text"))));
			for name in ["attribution", "size", "tone"] {
				copy_optional(&mut fields, &raw, name);
			}
		}
		"stat" => {
			for name in ["value", "label"] {
				fields.push((Text::new(name), raw.get(name).clone()));
			}
		}
		"bullets" => {
			let items = raw
				.get("items")
				.array()
				.unwrap()
				.iter()
				.map(|item| markup(item.record().unwrap().get("text")))
				.collect();
			fields.push((Text::new("items"), Value::Array(items)));
		}
		"steps" => {
			let items = raw
				.get("items")
				.array()
				.unwrap()
				.iter()
				.map(|item| {
					let item = item.record().unwrap();
					let mut fields = vec![(Text::new("title"), item.get("title").clone())];
					if !item.get("detail").undefined() {
						fields.push((Text::new("detail"), markup(item.get("detail"))));
					}
					Value::Object(Object(fields))
				})
				.collect();
			fields.push((Text::new("items"), Value::Array(items)));
		}
		"columns" => {
			let columns = raw
				.get("columns")
				.array()
				.unwrap()
				.iter()
				.map(|column| {
					let column = column.record().unwrap();
					let items = column
						.get("items")
						.array()
						.unwrap()
						.iter()
						.map(|item| markup(item.record().unwrap().get("text")))
						.collect();
					Value::object([
						("heading", column.get("heading").clone()),
						("items", Value::Array(items)),
					])
				})
				.collect();
			fields.push((Text::new("columns"), Value::Array(columns)));
		}
		"chart" => {
			for name in ["kind", "size", "categories"] {
				fields.push((Text::new(name), raw.get(name).clone()));
			}
			let series = raw
				.get("series")
				.array()
				.unwrap()
				.iter()
				.map(|series| {
					let series = series.record().unwrap();
					Value::object([
						("name", series.get("name").clone()),
						("values", series.get("values").clone()),
					])
				})
				.collect();
			fields.push((Text::new("series"), Value::Array(series)));
			for name in ["prefix", "suffix", "caption"] {
				copy_optional(&mut fields, &raw, name);
			}
		}
		"progress" => {
			fields.push((Text::new("size"), raw.get("size").clone()));
			let items = raw
				.get("items")
				.array()
				.unwrap()
				.iter()
				.map(|item| {
					let item = item.record().unwrap();
					Value::object([
						("label", item.get("label").clone()),
						("value", item.get("value").clone()),
					])
				})
				.collect();
			fields.push((Text::new("items"), Value::Array(items)));
		}
		"table" => {
			for name in ["size", "columns"] {
				fields.push((Text::new(name), raw.get(name).clone()));
			}
			let rows = raw
				.get("rows")
				.array()
				.unwrap()
				.iter()
				.map(|row| row.record().unwrap().get("cells").clone())
				.collect();
			fields.push((Text::new("rows"), Value::Array(rows)));
		}
		_ => unreachable!("validated node type"),
	}
	Some(Value::Object(Object(fields)))
}
