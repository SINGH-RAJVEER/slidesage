import { layoutMismatch } from "./layouts";
import {
	type Card,
	type CardDocument,
	type ContentNode,
	LAYOUTS,
	type LayoutId,
	type ListItem,
	type RichText,
	type TextRun,
	type ThemeId,
} from "./schema";

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

/** Replaces the rich text of a heading, paragraph, or quote. */
export function setNodeText(
	document: CardDocument,
	cardId: string,
	nodeId: string,
	text: RichText,
): CardDocument {
	return withNode(document, cardId, nodeId, (node) =>
		node.type === "heading" || node.type === "paragraph" || node.type === "quote"
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
