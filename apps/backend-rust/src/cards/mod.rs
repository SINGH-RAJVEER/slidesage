//! Drafting metadata, curated templates and native document validation.

mod templates;
pub use templates::template_deck;

use serde_json::Value;
use std::sync::LazyLock;

pub const SCHEMA_VERSION: u8 = 3;

/// Compiled into the worker, with no TypeScript runtime or filesystem dependency.
/// The existing converter tests compare every field against draftingSchema().
pub fn drafting_schema() -> &'static Value {
	static SCHEMA: LazyLock<Value> = LazyLock::new(|| {
		serde_json::from_str(include_str!("drafting-schema.json"))
			.expect("embedded drafting schema must be valid JSON")
	});
	&SCHEMA
}

pub mod validation;
