macro_rules! message { ($($arg:tt)*) => { Text::new(&format!($($arg)*)) }; }
use super::*;
type Rule = (
	&'static [(&'static str, usize, usize)],
	Option<(usize, usize)>,
);
fn rule(layout: &str) -> Rule {
	match layout {
		"title" => (&[("heading", 1, 1), ("paragraph", 0, 1)], None),
		"statement" => (&[("heading", 1, 1), ("paragraph", 1, 2)], None),
		"bullets" => (
			&[("heading", 1, 1), ("bullets", 1, 1), ("paragraph", 0, 1)],
			Some((2, 6)),
		),
		"comparison" => (&[("heading", 1, 1), ("columns", 1, 1)], Some((2, 5))),
		"process" => (&[("heading", 1, 1), ("steps", 1, 1)], Some((3, 6))),
		"quote" => (&[("heading", 0, 1), ("quote", 1, 1)], None),
		"stats" => (
			&[("heading", 1, 1), ("stat", 2, 4), ("paragraph", 0, 1)],
			None,
		),
		"image-left" | "image-right" => (
			&[
				("image", 1, 1),
				("heading", 1, 1),
				("paragraph", 0, 1),
				("bullets", 0, 1),
			],
			Some((2, 4)),
		),
		"cover" => (
			&[("image", 1, 1), ("heading", 1, 1), ("paragraph", 0, 1)],
			None,
		),
		"chart" => (
			&[
				("heading", 1, 1),
				("chart", 1, 1),
				("paragraph", 0, 1),
				("bullets", 0, 1),
				("callout", 0, 1),
			],
			Some((2, 4)),
		),
		"table" => (
			&[
				("heading", 1, 1),
				("table", 1, 1),
				("paragraph", 0, 1),
				("callout", 0, 1),
			],
			None,
		),
		"dashboard" => (
			&[
				("heading", 1, 1),
				("chart", 0, 4),
				("progress", 0, 4),
				("table", 0, 2),
				("callout", 0, 4),
			],
			None,
		),
		_ => unreachable!(),
	}
}
pub(super) fn mismatch(layout: &str, nodes: &[Value]) -> Option<Text> {
	let (bounds, items) = rule(layout);
	let mut counts = std::collections::HashMap::new();
	let mut sizes = Vec::new();
	for node in nodes {
		let raw = node.record().unwrap();
		let kind = raw.get("type").string().unwrap().display();
		if !bounds.iter().any(|(name, _, _)| *name == kind) {
			return Some(message!("layout \"{layout}\" does not accept {kind} nodes"));
		}
		*counts.entry(kind.clone()).or_insert(0usize) += 1;
		if let Some((min, max)) = items
			&& (kind == "bullets" || kind == "steps")
		{
			let size = raw.get("items").array().unwrap().len();
			if size < min || size > max {
				return Some(message!(
					"layout \"{layout}\" needs {min}-{max} {kind} items, got {size}"
				));
			}
		}
		if kind == "columns" {
			let columns = raw.get("columns").array().unwrap();
			if columns.len() < 2 || columns.len() > 3 {
				return Some(message!(
					"layout \"{layout}\" needs 2-3 columns, got {}",
					columns.len()
				));
			}
			for column in columns {
				let column = column.record().unwrap();
				let size = column.get("items").array().unwrap().len();
				if let Some((min, max)) = items
					&& (size < min || size > max)
				{
					let mut message = Text::new("column \"");
					message.0.extend(column.get("heading").string().unwrap().0);
					message
						.0
						.extend(format!("\" needs {min}-{max} items, got {size}").encode_utf16());
					return Some(message);
				}
			}
		}
		if ["chart", "progress", "table", "callout"].contains(&kind.as_str()) {
			sizes.push(raw.get("size").string().unwrap().display());
		}
	}
	if layout == "dashboard" {
		if sizes.len() < 2 || sizes.len() > 4 {
			return Some(message!(
				"layout \"{layout}\" needs 2-4 widgets, got {}",
				sizes.len()
			));
		}
		let mut rows = 0;
		let mut used = 12;
		for size in sizes {
			let span = match size.as_str() {
				"small" => 4,
				"medium" => 6,
				"large" => 8,
				_ => 12,
			};
			if used + span > 12 {
				rows += 1;
				used = 0;
			}
			used += span;
		}
		if rows > 2 {
			return Some(message!(
				"layout \"{layout}\" fits its widgets in 2 rows, these sizes need {rows}; use smaller sizes"
			));
		}
	}
	if (layout == "image-left" || layout == "image-right")
		&& !counts.contains_key("paragraph")
		&& !counts.contains_key("bullets")
	{
		return Some(message!(
			"layout \"{layout}\" needs a paragraph or bullets node"
		));
	}
	for (kind, min, max) in bounds {
		let count = counts.get(*kind).copied().unwrap_or(0);
		if count < *min || count > *max {
			let expected = if min == max {
				min.to_string()
			} else {
				format!("{min}-{max}")
			};
			return Some(message!(
				"layout \"{layout}\" needs {expected} {kind} node(s), got {count}"
			));
		}
	}
	None
}
