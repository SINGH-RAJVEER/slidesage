import type { ContentNode, ContentNodeType, LayoutId, WidgetNode } from "./schema";
import { DASHBOARD_ROWS, isWidget, widgetRows } from "./widgets";

interface Bounds {
	min: number;
	max: number;
}

export interface LayoutRule {
	/** How many nodes of each type the layout holds. Unlisted types are refused. */
	nodes: Partial<Record<ContentNodeType, Bounds>>;
	/** Item counts for list-like nodes, so a layout never receives more than it can show. */
	items?: Bounds;
	/** At least one node of these types must be present. */
	requireOneOf?: ContentNodeType[];
	/** Whether the layout shows an image, so drafting resolves one for it. */
	image?: boolean;
	/** How many widgets the layout holds in total, packed into at most two rows. */
	widgets?: Bounds;
	description: string;
}

/**
 * The content each layout supports. A layout is only accepted for a card
 * whose nodes fit it, which keeps layout choice a presentation of the content
 * rather than a way to overflow it.
 */
export const LAYOUT_RULES: Record<LayoutId, LayoutRule> = {
	title: {
		nodes: { heading: { min: 1, max: 1 }, paragraph: { min: 0, max: 1 } },
		description:
			"Large heading with an optional one-paragraph subtitle. For opening and closing cards.",
	},
	statement: {
		nodes: { heading: { min: 1, max: 1 }, paragraph: { min: 1, max: 2 } },
		description: "Heading with one or two short paragraphs making a single argument.",
	},
	bullets: {
		nodes: {
			heading: { min: 1, max: 1 },
			bullets: { min: 1, max: 1 },
			paragraph: { min: 0, max: 1 },
		},
		items: { min: 2, max: 6 },
		description: "Heading, two to six bullets, and an optional closing paragraph.",
	},
	comparison: {
		nodes: { heading: { min: 1, max: 1 }, columns: { min: 1, max: 1 } },
		items: { min: 2, max: 5 },
		description:
			"Heading and two or three columns, each with a short heading and two to five items.",
	},
	process: {
		nodes: { heading: { min: 1, max: 1 }, steps: { min: 1, max: 1 } },
		items: { min: 3, max: 6 },
		description: "Heading and three to six ordered steps, each with a title and optional detail.",
	},
	quote: {
		nodes: { heading: { min: 0, max: 1 }, quote: { min: 1, max: 1 } },
		description: "A single quotation with attribution and an optional heading.",
	},
	stats: {
		nodes: {
			heading: { min: 1, max: 1 },
			stat: { min: 2, max: 4 },
			paragraph: { min: 0, max: 1 },
		},
		description: "Heading, two to four headline figures with labels, and an optional paragraph.",
	},
	"image-left": {
		nodes: {
			image: { min: 1, max: 1 },
			heading: { min: 1, max: 1 },
			paragraph: { min: 0, max: 1 },
			bullets: { min: 0, max: 1 },
		},
		items: { min: 2, max: 4 },
		requireOneOf: ["paragraph", "bullets"],
		image: true,
		description:
			"Photo on the left half; heading with a short paragraph or two to four bullets on the right.",
	},
	"image-right": {
		nodes: {
			image: { min: 1, max: 1 },
			heading: { min: 1, max: 1 },
			paragraph: { min: 0, max: 1 },
			bullets: { min: 0, max: 1 },
		},
		items: { min: 2, max: 4 },
		requireOneOf: ["paragraph", "bullets"],
		image: true,
		description:
			"Heading with a short paragraph or two to four bullets on the left; photo on the right half.",
	},
	cover: {
		nodes: {
			image: { min: 1, max: 1 },
			heading: { min: 1, max: 1 },
			paragraph: { min: 0, max: 1 },
		},
		image: true,
		description:
			"Full-bleed photo behind a large heading and optional subtitle. For openings, section breaks, and closings.",
	},
	chart: {
		nodes: {
			heading: { min: 1, max: 1 },
			chart: { min: 1, max: 1 },
			paragraph: { min: 0, max: 1 },
			bullets: { min: 0, max: 1 },
			callout: { min: 0, max: 1 },
		},
		items: { min: 2, max: 4 },
		description:
			"Heading and one chart of real figures, with an optional short paragraph, two to four bullets, or a callout reading the chart. The chart's size sets its share of the width beside the text; a full chart sits above the text.",
	},
	table: {
		nodes: {
			heading: { min: 1, max: 1 },
			table: { min: 1, max: 1 },
			paragraph: { min: 0, max: 1 },
			callout: { min: 0, max: 1 },
		},
		description:
			"Heading and one table of two to five columns and up to eight rows, with an optional paragraph or callout. The table's size sets its share of the width beside the text; a full table sits above it.",
	},
	dashboard: {
		nodes: {
			heading: { min: 1, max: 1 },
			chart: { min: 0, max: 4 },
			progress: { min: 0, max: 4 },
			table: { min: 0, max: 2 },
			callout: { min: 0, max: 4 },
		},
		widgets: { min: 2, max: 4 },
		description:
			"Heading and two to four widgets (charts, progress meters, tables, callouts) in up to two rows. Widgets fill a row left to right by size: small is a third, medium a half, large two thirds, full the whole row.",
	},
};

export const COMPARISON_COLUMNS = { min: 2, max: 3 } as const;

function itemCount(node: ContentNode): number | undefined {
	switch (node.type) {
		case "bullets":
		case "steps":
			return node.items.length;
		default:
			return undefined;
	}
}

/** Explains why `nodes` do not fit `layout`, or returns null when they do. */
export function layoutMismatch(layout: LayoutId, nodes: ContentNode[]): string | null {
	const rule = LAYOUT_RULES[layout];
	const counts = new Map<ContentNodeType, number>();
	for (const node of nodes) {
		if (!rule.nodes[node.type]) return `layout "${layout}" does not accept ${node.type} nodes`;
		counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
		const items = itemCount(node);
		if (items !== undefined && rule.items && (items < rule.items.min || items > rule.items.max)) {
			return `layout "${layout}" needs ${rule.items.min}-${rule.items.max} ${node.type} items, got ${items}`;
		}
		if (node.type === "columns") {
			const columns = node.columns.length;
			if (columns < COMPARISON_COLUMNS.min || columns > COMPARISON_COLUMNS.max) {
				return `layout "${layout}" needs ${COMPARISON_COLUMNS.min}-${COMPARISON_COLUMNS.max} columns, got ${columns}`;
			}
			for (const column of node.columns) {
				const size = column.items.length;
				if (rule.items && (size < rule.items.min || size > rule.items.max)) {
					return `column "${column.heading}" needs ${rule.items.min}-${rule.items.max} items, got ${size}`;
				}
			}
		}
	}
	if (rule.widgets) {
		const widgets = nodes.filter(isWidget) as WidgetNode[];
		if (widgets.length < rule.widgets.min || widgets.length > rule.widgets.max) {
			return `layout "${layout}" needs ${rule.widgets.min}-${rule.widgets.max} widgets, got ${widgets.length}`;
		}
		const rows = widgetRows(widgets).length;
		if (rows > DASHBOARD_ROWS) {
			return `layout "${layout}" fits its widgets in ${DASHBOARD_ROWS} rows, these sizes need ${rows}; use smaller sizes`;
		}
	}
	if (rule.requireOneOf && !rule.requireOneOf.some((type) => counts.has(type))) {
		return `layout "${layout}" needs a ${rule.requireOneOf.join(" or ")} node`;
	}
	for (const [type, bounds] of Object.entries(rule.nodes) as [ContentNodeType, Bounds][]) {
		const count = counts.get(type) ?? 0;
		if (count < bounds.min || count > bounds.max) {
			const expected = bounds.min === bounds.max ? `${bounds.min}` : `${bounds.min}-${bounds.max}`;
			return `layout "${layout}" needs ${expected} ${type} node(s), got ${count}`;
		}
	}
	return null;
}

/** Layouts that hold an image. */
export const IMAGE_LAYOUTS = (Object.keys(LAYOUT_RULES) as LayoutId[]).filter(
	(layout) => LAYOUT_RULES[layout].image,
);
