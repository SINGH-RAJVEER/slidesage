import { LAYOUT_RULES } from "./layouts";
import {
	CARD_SCHEMA_VERSION,
	type Card,
	type ContentNode,
	LAYOUTS,
	LIMITS,
	NARRATIVE_ROLES,
	type RichText,
	THEMES,
} from "./schema";

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
	image: {
		type: "image",
		note: "Never write image nodes. For a layout that holds an image, the image node is added for you; draft only the text nodes.",
	},
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

/**
 * Writes runs back as draft markup. The format has no way to combine bold and
 * italic, so such a run keeps its bold.
 */
export function runsToMarkup(text: RichText): string {
	return text
		.map((run) => (run.bold ? `**${run.text}**` : run.italic ? `*${run.text}*` : run.text))
		.join("");
}

function nodeToDraft(node: ContentNode): Record<string, unknown> | null {
	switch (node.type) {
		case "image":
			return null;
		case "heading":
		case "paragraph":
			return { type: node.type, text: runsToMarkup(node.text) };
		case "bullets":
			return { type: "bullets", items: node.items.map((item) => runsToMarkup(item.text)) };
		case "quote":
			return {
				type: "quote",
				text: runsToMarkup(node.text),
				...(node.attribution ? { attribution: node.attribution } : {}),
			};
		case "stat":
			return { type: "stat", value: node.value, label: node.label };
		case "steps":
			return {
				type: "steps",
				items: node.items.map((step) => ({
					title: step.title,
					...(step.detail ? { detail: runsToMarkup(step.detail) } : {}),
				})),
			};
		case "columns":
			return {
				type: "columns",
				columns: node.columns.map((column) => ({
					heading: column.heading,
					items: column.items.map((item) => runsToMarkup(item.text)),
				})),
			};
	}
}

/**
 * A saved card in the shape the model drafts, so an AI revision reads the card
 * the way it would write it. IDs are dropped and image nodes are left out: the
 * server keeps the card's photo and adds it back.
 */
export function cardToDraft(card: Card) {
	return {
		takeaway: card.takeaway,
		layout: card.layout,
		nodes: card.nodes.flatMap((node) => {
			const draft = nodeToDraft(node);
			return draft ? [draft] : [];
		}),
		sourceIds: card.sourceIds,
		...(card.notes ? { notes: card.notes } : {}),
	};
}
