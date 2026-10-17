use super::*;

fn items(value: &Value, path: &Text, seen: &mut HashSet<Text>) -> Result<Value> {
	let mut result = Vec::new();
	for (index, value) in array(value, path)?.iter().enumerate() {
		let p = path.index(index);
		let raw = record(value, &p, &["id", "text"])?;
		result.push(Value::object([
			("id", id(raw.get("id"), &p.child("id"), seen)?),
			("text", rich_text(raw.get("text"), &p.child("text"), 160)?),
		]));
	}
	Ok(Value::Array(result))
}
fn strings(value: &Value, path: &Text, limit: usize) -> Result<Vec<Value>> {
	array(value, path)?
		.iter()
		.enumerate()
		.map(|(i, v)| text(v, &path.index(i), limit))
		.collect()
}
fn optional(
	fields: &mut Vec<(Text, Value)>,
	raw: &Object,
	path: &Text,
	name: &str,
	max: usize,
) -> Result<()> {
	if !raw.get(name).undefined() {
		fields.push((
			Text::new(name),
			text(raw.get(name), &path.child(name), max)?,
		));
	}
	Ok(())
}
pub(super) fn node(
	value: &Value,
	path: &Text,
	seen: &mut HashSet<Text>,
	assets: &HashSet<Text>,
) -> Result<Value> {
	let kind = value
		.record()
		.map(|raw| raw.get("type").clone())
		.unwrap_or(Value::Undefined);
	let name = kind
		.string()
		.map(|value| value.display())
		.unwrap_or_default();
	let keys: &[&str] = match name.as_str() {
		"heading" | "paragraph" => &["id", "type", "text"],
		"bullets" | "steps" => &["id", "type", "items"],
		"quote" => &["id", "type", "text", "attribution"],
		"stat" => &["id", "type", "value", "label"],
		"columns" => &["id", "type", "columns"],
		"image" => &["id", "type", "assetId", "alt", "fit", "focus"],
		"chart" => return chart(value, path, seen),
		"progress" => &["id", "type", "size", "items"],
		"table" => &["id", "type", "size", "columns", "rows"],
		"callout" => &["id", "type", "size", "tone", "text"],
		_ => {
			return fail(
				&path.child("type"),
				format!("unsupported node type {}", kind.stringify()),
			);
		}
	};
	let raw = record(value, path, keys)?;
	// Image asset checks precede ID validation in the reference implementation.
	if name == "image" {
		let Some(asset) = raw.get("assetId").string().filter(|value| {
			value.0.len() == 64 && value.0.iter().all(|unit| matches!(*unit,48..=57|97..=102))
		}) else {
			return fail(&path.child("assetId"), "is not an asset ID");
		};
		if !assets.contains(&asset) {
			return fail(
				&path.child("assetId"),
				"names an asset this presentation does not have",
			);
		}
	}
	let mut result = vec![
		(Text::new("id"), id(raw.get("id"), &path.child("id"), seen)?),
		(Text::new("type"), Value::text(&name)),
	];
	match name.as_str() {
		"heading" | "paragraph" | "quote" => {
			result.push((
				Text::new("text"),
				rich_text(
					raw.get("text"),
					&path.child("text"),
					match name.as_str() {
						"heading" => 90,
						"paragraph" => 420,
						_ => 280,
					},
				)?,
			));
			if name == "quote" {
				optional(&mut result, &raw, path, "attribution", 80)?;
			}
		}
		"bullets" => result.push((
			Text::new("items"),
			items(raw.get("items"), &path.child("items"), seen)?,
		)),
		"stat" => {
			result.push((
				Text::new("value"),
				text(raw.get("value"), &path.child("value"), 16)?,
			));
			result.push((
				Text::new("label"),
				text(raw.get("label"), &path.child("label"), 60)?,
			));
		}
		"steps" => {
			let p = path.child("items");
			let mut steps = Vec::new();
			for (index, value) in array(raw.get("items"), &p)?.iter().enumerate() {
				let p = p.index(index);
				let step = record(value, &p, &["id", "title", "detail"])?;
				let mut fields = vec![
					(Text::new("id"), id(step.get("id"), &p.child("id"), seen)?),
					(
						Text::new("title"),
						text(step.get("title"), &p.child("title"), 60)?,
					),
				];
				if !step.get("detail").undefined() {
					fields.push((
						Text::new("detail"),
						rich_text(step.get("detail"), &p.child("detail"), 200)?,
					));
				}
				steps.push(Value::Object(Object(fields)));
			}
			result.push((Text::new("items"), Value::Array(steps)));
		}
		"columns" => {
			let p = path.child("columns");
			let mut columns = Vec::new();
			for (index, value) in array(raw.get("columns"), &p)?.iter().enumerate() {
				let p = p.index(index);
				let column = record(value, &p, &["id", "heading", "items"])?;
				columns.push(Value::object([
					("id", id(column.get("id"), &p.child("id"), seen)?),
					(
						"heading",
						text(column.get("heading"), &p.child("heading"), 40)?,
					),
					(
						"items",
						items(column.get("items"), &p.child("items"), seen)?,
					),
				]));
			}
			result.push((Text::new("columns"), Value::Array(columns)));
		}
		"image" => {
			result.push((Text::new("assetId"), raw.get("assetId").clone()));
			result.push((
				Text::new("alt"),
				text(raw.get("alt"), &path.child("alt"), 200)?,
			));
			result.push((
				Text::new("fit"),
				one_of(raw.get("fit"), &path.child("fit"), &["cover", "contain"])?,
			));
			if !raw.get("focus").undefined() {
				let p = path.child("focus");
				let focus = record(raw.get("focus"), &p, &["x", "y"])?;
				let mut values = Vec::new();
				for field in ["x", "y"] {
					let Some(number) = focus
						.get(field)
						.number()
						.filter(|number| number.is_finite() && *number >= 0. && *number <= 1.)
					else {
						return fail(&p.child(field), "must be a number from 0 to 1");
					};
					values.push((Text::new(field), Value::Number(number)));
				}
				result.push((Text::new("focus"), Value::Object(Object(values))));
			}
		}
		"progress" => {
			let p = path.child("items");
			let mut meters = Vec::new();
			for (index, value) in array(raw.get("items"), &p)?.iter().enumerate() {
				let p = p.index(index);
				let meter = record(value, &p, &["id", "label", "value"])?;
				meters.push(Value::object([
					("id", id(meter.get("id"), &p.child("id"), seen)?),
					("label", text(meter.get("label"), &p.child("label"), 60)?),
					(
						"value",
						finite(meter.get("value"), &p.child("value"), 0., 100.)?,
					),
				]));
			}
			count(meters.len(), &p, 1, 6, "meters")?;
			result.push((
				Text::new("size"),
				one_of(raw.get("size"), &path.child("size"), SIZES)?,
			));
			result.push((Text::new("items"), Value::Array(meters)));
		}
		"table" => {
			let p = path.child("columns");
			let columns = strings(raw.get("columns"), &p, 32)?;
			count(columns.len(), &p, 2, 5, "columns")?;
			let p = path.child("rows");
			let mut rows = Vec::new();
			for (index, value) in array(raw.get("rows"), &p)?.iter().enumerate() {
				let p = p.index(index);
				let row = record(value, &p, &["id", "cells"])?;
				let mut cells = Vec::new();
				for (index, value) in array(row.get("cells"), &p.child("cells"))?
					.iter()
					.enumerate()
				{
					cells.push(if value.string().is_some_and(|text| text.0.is_empty()) {
						Value::text("")
					} else {
						text(value, &p.child("cells").index(index), 60)?
					});
				}
				if cells.len() != columns.len() {
					return fail(
						&p.child("cells"),
						format!("must hold one cell per column, {} in all", columns.len()),
					);
				}
				rows.push(Value::object([
					("id", id(row.get("id"), &p.child("id"), seen)?),
					("cells", Value::Array(cells)),
				]));
			}
			count(rows.len(), &p, 1, 8, "rows")?;
			result.push((
				Text::new("size"),
				one_of(raw.get("size"), &path.child("size"), SIZES)?,
			));
			result.push((Text::new("columns"), Value::Array(columns)));
			result.push((Text::new("rows"), Value::Array(rows)));
		}
		"callout" => {
			result.push((
				Text::new("size"),
				one_of(raw.get("size"), &path.child("size"), SIZES)?,
			));
			result.push((
				Text::new("tone"),
				one_of(
					raw.get("tone"),
					&path.child("tone"),
					&["note", "positive", "caution"],
				)?,
			));
			result.push((
				Text::new("text"),
				rich_text(raw.get("text"), &path.child("text"), 240)?,
			));
		}
		_ => unreachable!(),
	}
	Ok(Value::Object(Object(result)))
}
fn chart(value: &Value, path: &Text, seen: &mut HashSet<Text>) -> Result<Value> {
	let raw = record(
		value,
		path,
		&[
			"id",
			"type",
			"kind",
			"size",
			"categories",
			"series",
			"prefix",
			"suffix",
			"caption",
		],
	)?;
	let node_id = id(raw.get("id"), &path.child("id"), seen)?;
	let p = path.child("categories");
	let categories = strings(raw.get("categories"), &p, 24)?;
	count(categories.len(), &p, 2, 12, "categories")?;
	let mut unique = HashSet::new();
	if categories
		.iter()
		.any(|value| !unique.insert(value.string().unwrap()))
	{
		return fail(&p, "must not repeat");
	}
	let p = path.child("series");
	let series_raw = array(raw.get("series"), &p)?;
	count(series_raw.len(), &p, 1, 4, "series")?;
	let mut series = Vec::new();
	for (index, value) in series_raw.iter().enumerate() {
		let p = p.index(index);
		let entry = record(value, &p, &["id", "name", "values"])?;
		let values = array(entry.get("values"), &p.child("values"))?
			.iter()
			.enumerate()
			.map(|(i, v)| finite(v, &p.child("values").index(i), -1e12, 1e12))
			.collect::<Result<Vec<_>>>()?;
		if values.len() != categories.len() {
			return fail(
				&p.child("values"),
				format!(
					"must hold one value per category, {} in all",
					categories.len()
				),
			);
		}
		series.push(Value::object([
			("id", id(entry.get("id"), &p.child("id"), seen)?),
			("name", text(entry.get("name"), &p.child("name"), 40)?),
			("values", Value::Array(values)),
		]));
	}
	let kind = one_of(raw.get("kind"), &path.child("kind"), KINDS)?;
	let size = one_of(raw.get("size"), &path.child("size"), SIZES)?;
	let name = kind.string().unwrap().display();
	let mut fields = vec![
		(Text::new("id"), node_id),
		(Text::new("type"), Value::text("chart")),
		(Text::new("kind"), kind),
		(Text::new("size"), size),
		(Text::new("categories"), Value::Array(categories.clone())),
		(Text::new("series"), Value::Array(series.clone())),
	];
	for (field, max) in [("prefix", 8), ("suffix", 8), ("caption", 120)] {
		optional(&mut fields, &raw, path, field, max)?;
	}
	let mismatch = if name == "pie" || name == "donut" {
		if series.len() != 1 {
			Some(format!("a {name} chart shows exactly one series"))
		} else if categories.len() > 6 {
			Some(format!("a {name} chart shows at most 6 slices"))
		} else {
			let values = series[0].record().unwrap().get("values").array().unwrap();
			if values.iter().any(|v| v.number().unwrap() < 0.) {
				Some(format!("a {name} chart cannot show negative values"))
			} else if !values.iter().any(|v| v.number().unwrap() > 0.) {
				Some(format!("a {name} chart needs a value above zero"))
			} else {
				None
			}
		}
	} else if name == "stacked-column" && series.len() < 2 {
		Some("a stacked-column chart needs at least two series".into())
	} else {
		None
	};
	if let Some(message) = mismatch {
		return fail(&path.child("kind"), message);
	}
	Ok(Value::Object(Object(fields)))
}
