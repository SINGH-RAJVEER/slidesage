import { LAYOUT_RULES } from "./layouts";
import {
	CALLOUT_TONES,
	CARD_SCHEMA_VERSION,
	type Card,
	CHART_KINDS,
	type ContentNode,
	LAYOUTS,
	LIMITS,
	NARRATIVE_ROLES,
	type RichText,
	THEMES,
	WIDGET_SIZES,
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
	chart: {
		type: "chart",
		kind: `one of ${CHART_KINDS.join(", ")}`,
		size: `one of ${WIDGET_SIZES.join(", ")}`,
		categories: ["string, e.g. 2023 or Europe"],
		series: [{ name: "string", values: ["number, one per category, without units"] }],
		prefix: "optional string written before values, e.g. $",
		suffix: "optional string written after values, e.g. % or B",
		caption: "optional string naming where the figures come from",
	},
	progress: {
		type: "progress",
		size: `one of ${WIDGET_SIZES.join(", ")}`,
		items: [{ label: "string", value: "number from 0 to 100, a percentage" }],
	},
	table: {
		type: "table",
		size: `one of ${WIDGET_SIZES.join(", ")}`,
		columns: ["string column heading"],
		rows: [["string cell, one per column"]],
	},
	callout: {
		type: "callout",
		size: `one of ${WIDGET_SIZES.join(", ")}`,
		tone: `one of ${CALLOUT_TONES.join(", ")}`,
		text: "string",
	},
} as const;

/** How to choose and size widgets, sent with the schema. */
export const DRAFT_WIDGET_GUIDE = {
	data: "Charts, meters, and tables show only figures stated in the research sources or the user's notes. Never invent, estimate, or round figures into new ones; when the figures are missing, use a text layout instead.",
	kinds: {
		column: "values compared across a few categories, or a short series over time",
		bar: "values compared across categories with long names, or ranked",
		"stacked-column": "how two to four parts make up each category's total",
		line: "change over time across many periods, for one to four series",
		area: "change in one or two totals over time, where the volume matters",
		pie: "parts of one whole, two to six slices; one series only",
		donut: "parts of one whole with the total as the point; one series only",
	},
	sizes:
		"small is a third of a row, medium a half, large two thirds, full the whole row. In a chart or table card the size is the widget's share of the width beside the text, and a full widget sits above it.",
	tones: "note for context, positive for a gain or success, caution for a risk or limit",
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
		widgets: DRAFT_WIDGET_GUIDE,
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
		case "chart":
			return {
				type: "chart",
				kind: node.kind,
				size: node.size,
				categories: node.categories,
				series: node.series.map((series) => ({ name: series.name, values: series.values })),
				...(node.prefix ? { prefix: node.prefix } : {}),
				...(node.suffix ? { suffix: node.suffix } : {}),
				...(node.caption ? { caption: node.caption } : {}),
			};
		case "progress":
			return {
				type: "progress",
				size: node.size,
				items: node.items.map((meter) => ({ label: meter.label, value: meter.value })),
			};
		case "table":
			return {
				type: "table",
				size: node.size,
				columns: node.columns,
				rows: node.rows.map((row) => row.cells),
			};
		case "callout":
			return { type: "callout", size: node.size, tone: node.tone, text: runsToMarkup(node.text) };
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
