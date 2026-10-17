//! Curated starter decks compiled into the converter worker.

use serde_json::Value;
use std::sync::LazyLock;

/// Regenerate the embedded catalog with `bun libs/cards-rust/scripts/templates.ts`.
/// Converter tests compare every response with the current TypeScript catalog.
pub fn template_deck(id: &str) -> Option<&'static Value> {
	static TEMPLATES: LazyLock<Value> = LazyLock::new(|| {
		serde_json::from_str(include_str!("templates.json"))
			.expect("embedded template catalog must be valid JSON")
	});
	TEMPLATES.get(id)
}
