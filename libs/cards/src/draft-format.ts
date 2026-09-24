import { LAYOUT_RULES } from "./layouts";
import { CARD_SCHEMA_VERSION, LAYOUTS, LIMITS, NARRATIVE_ROLES, THEMES } from "./schema";

/**
 * The shape the model drafts a card in. Text fields accept `**bold**` and
 * `*italic*`; nothing else is interpreted. IDs are assigned by the converter.
 */
export const DRAFT_NODE_SHAPES = {
	heading: { type: "heading", text: "string" },
	paragraph: { type: "paragraph", text: "string" },
	bullets: { type: "bullets", items: ["string"] },
	quote: { type: "quote", text: "string", attribution: "optional string" },
	stat: { type: "stat", value: "string, e.g. 42% or $3.1B", label: "string" },
	steps: { type: "steps", items: [{ title: "string", detail: "optional string" }] },
	columns: { type: "columns", columns: [{ heading: "string", items: ["string"] }] },
} as const;

export const DRAFT_CARD_SHAPE = {
	position: "number, as assigned in the plan",
	layout: `one of ${LAYOUTS.join(", ")}`,
	nodes: "array of nodes in reading order",
	sourceIds: "array of research source IDs the card uses, e.g. s1",
	notes: "optional speaker notes",
} as const;

/** Everything a drafting prompt needs to know about the schema, from its one authority. */
export function draftingSchema() {
	return {
		schemaVersion: CARD_SCHEMA_VERSION,
		themes: THEMES,
		roles: NARRATIVE_ROLES,
		layouts: LAYOUT_RULES,
		limits: LIMITS,
		card: DRAFT_CARD_SHAPE,
		nodes: DRAFT_NODE_SHAPES,
	};
}
