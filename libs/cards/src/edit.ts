import { cleanAffix } from "./convert";
import { layoutMismatch } from "./layouts";
import {
	type CalloutTone,
	type Card,
	type CardDocument,
	type ChartKind,
	type ChartNode,
	type ContentNode,
	LAYOUTS,
	type LayoutId,
	LIMITS,
	type ListItem,
	type RichText,
	type TextRun,
	type ThemeId,
	type WidgetNode,
	type WidgetSize,
	type WidgetType,
} from "./schema";
import { compatibleChartKinds, FEATURE_TEXT, isWidget } from "./widgets";

/**
 * Pure edit operations on a card document. Each returns a new document and
 * leaves the input untouched, so an editor can keep earlier documents for
 * undo. Operations never produce a document the schema would refuse, except
 * text the user has not finished typing, which validation reports on save.
 */

/** A random ID in the schema's ID format, for content the editor creates. */
export function newId(prefix: "c" | "n" | "i"): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	const value = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("");
	return `${prefix}_${value.slice(0, 14)}`;
}

/** Merges neighbouring runs with the same marks and drops empty ones. */
export function normalizeRuns(runs: RichText): RichText {
	const merged: TextRun[] = [];
	for (const run of runs) {
		if (run.text === "") continue;
		const last = merged[merged.length - 1];
		if (last && last.bold === run.bold && last.italic === run.italic) {
			last.text += run.text;
		} else {
			merged.push({ ...run });
		}
	}
	return merged;
}

export function plainRuns(text: string): RichText {
	return [{ text }];
}

function withCard(
	document: CardDocument,
	cardId: string,
	update: (card: Card) => Card,
): CardDocument {
	const card = document.cards[cardId];
	if (!card) return document;
	return { ...document, cards: { ...document.cards, [cardId]: update(card) } };
}

function withNode(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	update: (node: ContentNode) => ContentNode,
): CardDocument {
	return withCard(document, cardId, (card) => ({
		...card,
		nodes: card.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
	}));
}

export function setTitle(document: CardDocument, title: string): CardDocument {
	return { ...document, title };
}

export function setTheme(document: CardDocument, theme: ThemeId): CardDocument {
	return { ...document, theme };
}

/** Replaces the rich text of a heading, paragraph, quote, or callout. */
export function setNodeText(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	text: RichText,
): CardDocument {
	return withNode(document, cardId, nodeId, (node) =>
		node.type === "heading" ||
		node.type === "paragraph" ||
		node.type === "quote" ||
		node.type === "callout"
			? { ...node, text: normalizeRuns(text) }
			: node,
	);
}

type PlainField =
	| { type: "stat"; field: "value" | "label" }
	| { type: "quote"; field: "attribution" }
	| { type: "image"; field: "alt" };

/** Replaces a plain-text field such as a stat value or a quote attribution. */
export function setNodeField(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	target: PlainField,
	value: string,
): CardDocument {
	return withNode(document, cardId, nodeId, (node) => {
		if (node.type !== target.type) return node;
		if (node.type === "quote" && value.trim() === "") {
			const { attribution: _removed, ...rest } = node;
			return rest;
		}
		return { ...node, [target.field]: value } as ContentNode;
	});
}

function editItems(items: ListItem[], itemId: string, text: RichText): ListItem[] {
	return items.map((item) => (item.id === itemId ? { ...item, text: normalizeRuns(text) } : item));
}

/** Replaces the text of a bullet or a column item. */
export function setItemText(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	itemId: string,
	text: RichText,
): CardDocument {
	return withNode(document, cardId, nodeId, (node) => {
		if (node.type === "bullets") return { ...node, items: editItems(node.items, itemId, text) };
		if (node.type === "columns") {
			return {
				...node,
				columns: node.columns.map((column) => ({
					...column,
					items: editItems(column.items, itemId, text),
				})),
			};
		}
		return node;
	});
}

/** Edits a step's title or detail, or a column's heading. */
export function setPartField(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	partId: string,
	field: "title" | "detail" | "heading",
	value: string | RichText,
): CardDocument {
	return withNode(document, cardId, nodeId, (node) => {
		if (node.type === "steps" && (field === "title" || field === "detail")) {
			return {
				...node,
				items: node.items.map((step) => {
					if (step.id !== partId) return step;
					if (field === "title") return { ...step, title: String(value) };
					const detail = typeof value === "string" ? plainRuns(value) : normalizeRuns(value);
					if (detail.length === 0) {
						const { detail: _removed, ...rest } = step;
						return rest;
					}
					return { ...step, detail };
				}),
			};
		}
		if (node.type === "columns" && field === "heading") {
			return {
				...node,
				columns: node.columns.map((column) =>
					column.id === partId ? { ...column, heading: String(value) } : column,
				),
			};
		}
		return node;
	});
}

/** Adds an item after `afterItemId`, or at the end. */
export function addListItem(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	options: { columnId?: string; afterItemId?: string } = {},
): CardDocument {
	const insert = <T extends { id: string }>(items: T[], item: T): T[] => {
		const index = options.afterItemId
			? items.findIndex((entry) => entry.id === options.afterItemId)
			: -1;
		const at = index === -1 ? items.length : index + 1;
		return [...items.slice(0, at), item, ...items.slice(at)];
	};
	return withNode(document, cardId, nodeId, (node) => {
		if (node.type === "bullets") {
			return {
				...node,
				items: insert(node.items, { id: newId("i"), text: plainRuns("New point") }),
			};
		}
		if (node.type === "steps") {
			return { ...node, items: insert(node.items, { id: newId("i"), title: "New step" }) };
		}
		if (node.type === "progress") {
			if (node.items.length >= LIMITS.meters.max) return node;
			return {
				...node,
				items: insert(node.items, { id: newId("i"), label: "New measure", value: 50 }),
			};
		}
		if (node.type === "table") {
			if (node.rows.length >= LIMITS.tableRows.max) return node;
			return {
				...node,
				rows: insert(node.rows, { id: newId("i"), cells: node.columns.map(() => "") }),
			};
		}
		if (node.type === "columns") {
			return {
				...node,
				columns: node.columns.map((column) =>
					column.id === options.columnId
						? {
								...column,
								items: insert(column.items, { id: newId("i"), text: plainRuns("New point") }),
							}
						: column,
				),
			};
		}
		return node;
	});
}

export function removeListItem(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	itemId: string,
): CardDocument {
	const drop = <T extends { id: string }>(items: T[]) => items.filter((item) => item.id !== itemId);
	return withNode(document, cardId, nodeId, (node) => {
		if (node.type === "bullets") return { ...node, items: drop(node.items) };
		if (node.type === "steps") return { ...node, items: drop(node.items) };
		if (node.type === "progress" && node.items.length > LIMITS.meters.min) {
			return { ...node, items: drop(node.items) };
		}
		if (node.type === "table" && node.rows.length > LIMITS.tableRows.min) {
			return { ...node, rows: drop(node.rows) };
		}
		if (node.type === "columns") {
			return {
				...node,
				columns: node.columns.map((column) => ({ ...column, items: drop(column.items) })),
			};
		}
		return node;
	});
}

/** Layouts that can show the card's current content unchanged. */
export function compatibleLayouts(card: Card): LayoutId[] {
	return LAYOUTS.filter((layout) => layoutMismatch(layout, card.nodes) === null);
}

export function setLayout(document: CardDocument, cardId: string, layout: LayoutId): CardDocument {
	const card = document.cards[cardId];
	if (!card || card.layout === layout || layoutMismatch(layout, card.nodes) !== null)
		return document;
	return withCard(document, cardId, (current) => ({ ...current, layout }));
}

/** Moves a card up (negative) or down (positive) in the deck. */
export function moveCard(document: CardDocument, cardId: string, offset: number): CardDocument {
	const index = document.cardOrder.indexOf(cardId);
	const target = index + offset;
	if (index === -1 || target < 0 || target >= document.cardOrder.length) return document;
	const order = [...document.cardOrder];
	order.splice(index, 1);
	order.splice(target, 0, cardId);
	return { ...document, cardOrder: order };
}

/** Places a card at a new index, for drag-and-drop. */
export function placeCard(document: CardDocument, cardId: string, index: number): CardDocument {
	const current = document.cardOrder.indexOf(cardId);
	return current === -1 ? document : moveCard(document, cardId, index - current);
}

function reissueIds(card: Card): Card {
	const nodes = card.nodes.map((node): ContentNode => {
		const id = newId("n");
		switch (node.type) {
			case "bullets":
				return { ...node, id, items: node.items.map((item) => ({ ...item, id: newId("i") })) };
			case "steps":
				return { ...node, id, items: node.items.map((step) => ({ ...step, id: newId("i") })) };
			case "progress":
				return { ...node, id, items: node.items.map((meter) => ({ ...meter, id: newId("i") })) };
			case "chart":
				return {
					...node,
					id,
					series: node.series.map((series) => ({ ...series, id: newId("i") })),
				};
			case "table":
				return { ...node, id, rows: node.rows.map((row) => ({ ...row, id: newId("i") })) };
			case "columns":
				return {
					...node,
					id,
					columns: node.columns.map((column) => ({
						...column,
						id: newId("i"),
						items: column.items.map((item) => ({ ...item, id: newId("i") })),
					})),
				};
			default:
				return { ...node, id };
		}
	});
	return { ...structuredClone(card), id: newId("c"), nodes: structuredClone(nodes) };
}

function insertAfter(document: CardDocument, afterId: string | null, card: Card): CardDocument {
	const index = afterId ? document.cardOrder.indexOf(afterId) : document.cardOrder.length - 1;
	const order = [...document.cardOrder];
	order.splice(index + 1, 0, card.id);
	return { ...document, cardOrder: order, cards: { ...document.cards, [card.id]: card } };
}

export function duplicateCard(document: CardDocument, cardId: string): CardDocument {
	const card = document.cards[cardId];
	return card ? insertAfter(document, cardId, reissueIds(card)) : document;
}

export function deleteCard(document: CardDocument, cardId: string): CardDocument {
	if (document.cardOrder.length <= 1 || !document.cards[cardId]) return document;
	const { [cardId]: _removed, ...cards } = document.cards;
	return { ...document, cardOrder: document.cardOrder.filter((id) => id !== cardId), cards };
}

/** A new text card for the user to fill in. */
export function newCard(): Card {
	return {
		id: newId("c"),
		takeaway: "New card",
		role: "insight",
		layout: "statement",
		nodes: [
			{ id: newId("n"), type: "heading", text: plainRuns("New card") },
			{ id: newId("n"), type: "paragraph", text: plainRuns("Add your point here.") },
		],
		sourceIds: [],
	};
}

export function addCard(
	document: CardDocument,
	afterId: string | null,
	card: Card = newCard(),
): CardDocument {
	return insertAfter(document, afterId, card);
}

/** Keeps a card's takeaway in step with its heading, which is what the takeaway summarizes. */
export function syncTakeaway(document: CardDocument, cardId: string): CardDocument {
	return withCard(document, cardId, (card) => {
		const heading = card.nodes.find((node) => node.type === "heading");
		if (heading?.type !== "heading") return card;
		const text = heading.text
			.map((run) => run.text)
			.join("")
			.trim();
		return text ? { ...card, takeaway: text.slice(0, 200) } : card;
	});
}

const IMAGE_LAYOUT_PREFERENCE: LayoutId[] = ["image-right", "image-left", "cover"];
const TEXT_LAYOUT_PREFERENCE: LayoutId[] = [
	"statement",
	"bullets",
	"title",
	"comparison",
	"process",
	"quote",
	"stats",
];

/** Whether a photo can be added to the card without changing its text. */
export function canAddImage(card: Card): boolean {
	if (card.nodes.some((node) => node.type === "image")) return true;
	const withImage: ContentNode[] = [
		{ id: "n_preview", type: "image", assetId: "0".repeat(64), alt: "preview", fit: "cover" },
		...card.nodes,
	];
	return IMAGE_LAYOUT_PREFERENCE.some((layout) => layoutMismatch(layout, withImage) === null);
}

/**
 * Shows an image on a card: replaces the card's photo, or adds one and moves
 * the card to the first image layout its text fits. A card whose text fits no
 * image layout is left unchanged.
 */
export function setImage(
	document: CardDocument,
	cardId: string,
	assetId: string,
	alt: string,
): CardDocument {
	const card = document.cards[cardId];
	if (!card) return document;
	const existing = card.nodes.find((node) => node.type === "image");
	if (existing) {
		return withNode(document, cardId, existing.id, (node) =>
			node.type === "image" ? { ...node, assetId, alt, focus: undefined } : node,
		);
	}
	const nodes: ContentNode[] = [
		{ id: newId("n"), type: "image", assetId, alt, fit: "cover" },
		...card.nodes,
	];
	const layout = IMAGE_LAYOUT_PREFERENCE.find(
		(candidate) => layoutMismatch(candidate, nodes) === null,
	);
	if (!layout) return document;
	return withCard(document, cardId, (current) => ({ ...current, layout, nodes }));
}

/** Removes a card's photo and moves it to the first text layout that fits. */
export function removeImage(document: CardDocument, cardId: string): CardDocument {
	const card = document.cards[cardId];
	if (!card?.nodes.some((node) => node.type === "image")) return document;
	const nodes = card.nodes.filter((node) => node.type !== "image");
	const layout = TEXT_LAYOUT_PREFERENCE.find(
		(candidate) => layoutMismatch(candidate, nodes) === null,
	);
	if (!layout) return document;
	return withCard(document, cardId, (current) => ({ ...current, layout, nodes }));
}

function withWidget<T extends WidgetNode["type"]>(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	type: T,
	update: (node: Extract<WidgetNode, { type: T }>) => Extract<WidgetNode, { type: T }>,
): CardDocument {
	return withNode(document, cardId, nodeId, (node) =>
		node.type === type ? update(node as Extract<WidgetNode, { type: T }>) : node,
	);
}

/** Applies a change to a card only if the result still fits the card's layout. */
function ifFits(document: CardDocument, cardId: string, next: CardDocument): CardDocument {
	const card = next.cards[cardId];
	return card && layoutMismatch(card.layout, card.nodes) === null ? next : document;
}

/** Sizes the widget can take without breaking its card's layout. */
export function compatibleSizes(card: Card, nodeId: string): WidgetSize[] {
	return (["small", "medium", "large", "full"] as const).filter((size) => {
		const nodes = card.nodes.map((node) =>
			node.id === nodeId && isWidget(node) ? { ...node, size } : node,
		);
		return layoutMismatch(card.layout, nodes) === null;
	});
}

export function setWidgetSize(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	size: WidgetSize,
): CardDocument {
	return ifFits(
		document,
		cardId,
		withNode(document, cardId, nodeId, (node) => (isWidget(node) ? { ...node, size } : node)),
	);
}

/** Changes how a chart draws its data, if the data suits that kind. */
export function setChartKind(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	kind: ChartKind,
): CardDocument {
	const node = document.cards[cardId]?.nodes.find((entry) => entry.id === nodeId);
	if (node?.type !== "chart" || !compatibleChartKinds(node).includes(kind)) return document;
	return withWidget(document, cardId, nodeId, "chart", (chart) => ({ ...chart, kind }));
}

export interface ChartData {
	categories: string[];
	/** Series without an ID are new and are given one. */
	series: { id?: string; name: string; values: number[] }[];
	prefix?: string;
	suffix?: string;
	caption?: string;
}

/**
 * Replaces a chart's data. A chart whose kind no longer suits the data, such as
 * a pie given a second series, switches to the first kind that does.
 */
export function setChartData(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	data: ChartData,
): CardDocument {
	return withWidget(document, cardId, nodeId, "chart", (node) => {
		const next: ChartNode = {
			id: node.id,
			type: "chart",
			kind: node.kind,
			size: node.size,
			categories: data.categories,
			series: data.series.map((series) => ({
				id: series.id ?? newId("i"),
				name: series.name,
				values: series.values,
			})),
		};
		for (const side of ["prefix", "suffix"] as const) {
			const affix = cleanAffix(data[side] ?? "", side);
			if (affix) next[side] = affix;
		}
		const caption = data.caption?.trim();
		if (caption) next.caption = caption;
		const kinds = compatibleChartKinds(next);
		if (!kinds.includes(next.kind)) next.kind = kinds[0] ?? "column";
		return next;
	});
}

export function setCalloutTone(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	tone: CalloutTone,
): CardDocument {
	return withWidget(document, cardId, nodeId, "callout", (node) => ({ ...node, tone }));
}

/** Edits a meter's label or value; values are clamped to 0-100. */
export function setMeter(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	meterId: string,
	change: { label?: string; value?: number },
): CardDocument {
	return withWidget(document, cardId, nodeId, "progress", (node) => ({
		...node,
		items: node.items.map((meter) => {
			if (meter.id !== meterId) return meter;
			const next = { ...meter };
			if (change.label !== undefined) next.label = change.label;
			if (change.value !== undefined && Number.isFinite(change.value)) {
				next.value = Math.min(100, Math.max(0, change.value));
			}
			return next;
		}),
	}));
}

/** Edits a table cell, or a column heading when `rowId` is null. */
export function setTableCell(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	rowId: string | null,
	column: number,
	value: string,
): CardDocument {
	return withWidget(document, cardId, nodeId, "table", (node) => {
		if (rowId === null) {
			return {
				...node,
				columns: node.columns.map((heading, index) => (index === column ? value : heading)),
			};
		}
		return {
			...node,
			rows: node.rows.map((row) =>
				row.id === rowId
					? { ...row, cells: row.cells.map((cell, index) => (index === column ? value : cell)) }
					: row,
			),
		};
	});
}

export function addTableColumn(
	document: CardDocument,
	cardId: string,
	nodeId: string,
): CardDocument {
	return withWidget(document, cardId, nodeId, "table", (node) => {
		if (node.columns.length >= LIMITS.tableColumns.max) return node;
		return {
			...node,
			columns: [...node.columns, "New column"],
			rows: node.rows.map((row) => ({ ...row, cells: [...row.cells, ""] })),
		};
	});
}

export function removeTableColumn(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	column: number,
): CardDocument {
	return withWidget(document, cardId, nodeId, "table", (node) => {
		if (node.columns.length <= LIMITS.tableColumns.min) return node;
		const keep = (_: unknown, index: number) => index !== column;
		return {
			...node,
			columns: node.columns.filter(keep),
			rows: node.rows.map((row) => ({ ...row, cells: row.cells.filter(keep) })),
		};
	});
}

/** A widget with placeholder content for the user to replace. */
export function newWidget(type: WidgetType, size: WidgetSize = "medium"): WidgetNode {
	switch (type) {
		case "chart":
			return {
				id: newId("n"),
				type: "chart",
				kind: "column",
				size,
				categories: ["2023", "2024", "2025"],
				series: [{ id: newId("i"), name: "Value", values: [12, 18, 26] }],
			};
		case "progress":
			return {
				id: newId("n"),
				type: "progress",
				size,
				items: [
					{ id: newId("i"), label: "Complete", value: 60 },
					{ id: newId("i"), label: "In progress", value: 30 },
				],
			};
		case "table":
			return {
				id: newId("n"),
				type: "table",
				size,
				columns: ["Option", "Detail"],
				rows: [
					{ id: newId("i"), cells: ["First", "Add detail"] },
					{ id: newId("i"), cells: ["Second", "Add detail"] },
				],
			};
		case "callout":
			return {
				id: newId("n"),
				type: "callout",
				size,
				tone: "note",
				text: plainRuns("Add a highlight."),
			};
	}
}

/** The layouts a card moves to when a widget of each type is added, in preference order. */
const WIDGET_LAYOUT_PREFERENCE: Record<WidgetType, LayoutId[]> = {
	chart: ["chart", "dashboard"],
	table: ["table", "dashboard"],
	progress: ["dashboard"],
	callout: ["chart", "table", "dashboard"],
};

const SIZE_PREFERENCE: WidgetSize[] = ["medium", "small", "large", "full"];

/** The card that results from adding a widget of `type`, or null when its content cannot hold one. */
function withAddedWidget(card: Card, type: WidgetType): Card | null {
	const layouts = [card.layout, ...WIDGET_LAYOUT_PREFERENCE[type]];
	for (const layout of new Set(layouts)) {
		const feature = layout === type && (layout === "chart" || layout === "table");
		const hasText = card.nodes.some((node) => FEATURE_TEXT.includes(node.type));
		const sizes: WidgetSize[] = feature ? [hasText ? "large" : "full"] : SIZE_PREFERENCE;
		for (const size of sizes) {
			const nodes = [...card.nodes, newWidget(type, size)];
			if (layoutMismatch(layout, nodes) === null) return { ...card, layout, nodes };
		}
	}
	return null;
}

/** Whether a widget of `type` can be added to the card without changing its other content. */
export function canAddWidget(card: Card, type: WidgetType): boolean {
	return withAddedWidget(card, type) !== null;
}

/**
 * Adds a placeholder widget to a card, keeping its layout when it has room and
 * otherwise moving it to the first layout that holds the widget and the
 * card's content. A card that cannot hold one is left unchanged.
 */
export function addWidget(document: CardDocument, cardId: string, type: WidgetType): CardDocument {
	const card = document.cards[cardId];
	const next = card ? withAddedWidget(card, type) : null;
	return next ? withCard(document, cardId, () => next) : document;
}

/** Whether the card's layout still holds its content without this widget. */
export function canRemoveWidget(card: Card, nodeId: string): boolean {
	const nodes = card.nodes.filter((node) => node.id !== nodeId);
	return nodes.length < card.nodes.length && layoutMismatch(card.layout, nodes) === null;
}

/** Removes a widget if the card's layout still holds what remains. */
export function removeWidget(document: CardDocument, cardId: string, nodeId: string): CardDocument {
	return ifFits(
		document,
		cardId,
		withCard(document, cardId, (card) => ({
			...card,
			nodes: card.nodes.filter((node) => node.id !== nodeId),
		})),
	);
}

/** A new chart, table, or dashboard card with placeholder content. */
export function newWidgetCard(layout: "chart" | "table" | "dashboard"): Card {
	const heading = { id: newId("n"), type: "heading" as const, text: plainRuns("New card") };
	const nodes: ContentNode[] =
		layout === "dashboard"
			? [heading, newWidget("chart", "large"), newWidget("progress", "small")]
			: [heading, newWidget(layout, "full")];
	return {
		id: newId("c"),
		takeaway: "New card",
		role: "evidence",
		layout,
		nodes,
		sourceIds: [],
	};
}
