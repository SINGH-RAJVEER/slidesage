import { describe, expect, it } from "bun:test";
import { assembleDocument, convertCards } from "./convert";
import {
	addCard,
	addListItem,
	compatibleLayouts,
	deleteCard,
	duplicateCard,
	moveCard,
	newId,
	normalizeRuns,
	removeListItem,
	setItemText,
	setLayout,
	setNodeText,
	setTheme,
	syncTakeaway,
} from "./edit";
import type { CardDocument } from "./schema";
import { validateCardDocument } from "./validate";

function deck(): CardDocument {
	const results = convertCards({
		operationId: "edit",
		sourceIds: [],
		cards: [
			{
				position: 1,
				takeaway: "Opening",
				role: "opening",
				draft: { layout: "title", nodes: [{ type: "heading", text: "Grid storage" }] },
			},
			{
				position: 2,
				takeaway: "Reasons",
				role: "evidence",
				draft: {
					layout: "bullets",
					nodes: [
						{ type: "heading", text: "Why it matters" },
						{ type: "bullets", items: ["Cheaper", "Faster"] },
					],
				},
			},
		],
	});
	return assembleDocument({
		title: "Grid storage",
		theme: "slate",
		cards: results.map((result) => {
			if (!("card" in result)) throw new Error(result.issue.message);
			return result.card;
		}),
	});
}

function valid(document: CardDocument) {
	const result = validateCardDocument(document);
	if (!result.ok) throw new Error(`${result.issue.path}: ${result.issue.message}`);
	return result.value;
}

describe("edit operations", () => {
	it("mints IDs the schema accepts", () => {
		const id = newId("c");
		expect(id).toMatch(/^c_[a-z0-9]{6,32}$/);
		expect(newId("c")).not.toBe(id);
	});

	it("edits text without touching other cards", () => {
		const original = deck();
		const [first, second] = original.cardOrder as [string, string];
		const heading = original.cards[first]?.nodes[0];
		const edited = setNodeText(original, first, heading?.id ?? "", [
			{ text: "Grid " },
			{ text: "storage", bold: true },
			{ text: " in 2026", bold: true },
		]);
		expect(edited.cards[first]?.nodes[0]).toMatchObject({
			text: [{ text: "Grid " }, { text: "storage in 2026", bold: true }],
		});
		expect(edited.cards[second]).toBe(original.cards[second]);
		expect(original.cards[first]?.nodes[0]).toEqual(heading);
		valid(edited);
	});

	it("adds, edits, and removes bullets", () => {
		const document = deck();
		const card = document.cards[document.cardOrder[1] ?? ""];
		const bullets = card?.nodes[1];
		if (!card || bullets?.type !== "bullets") throw new Error("fixture");
		let edited = addListItem(document, card.id, bullets.id, { afterItemId: bullets.items[0]?.id });
		const added = edited.cards[card.id]?.nodes[1];
		if (added?.type !== "bullets") throw new Error("bullets");
		expect(added.items).toHaveLength(3);
		const newItem = added.items[1];
		edited = setItemText(edited, card.id, bullets.id, newItem?.id ?? "", [{ text: "Cleaner" }]);
		valid(edited);
		edited = removeListItem(edited, card.id, bullets.id, newItem?.id ?? "");
		expect(valid(edited)).toEqual(valid(document));
	});

	it("moves, duplicates, and deletes cards", () => {
		const document = deck();
		const [first, second] = document.cardOrder as [string, string];
		expect(moveCard(document, second, -1).cardOrder).toEqual([second, first]);
		expect(moveCard(document, first, -1)).toBe(document);
		const duplicated = valid(duplicateCard(document, second));
		expect(duplicated.cardOrder).toHaveLength(3);
		expect(duplicated.cardOrder[2]).not.toBe(second);
		const deleted = deleteCard(document, first);
		expect(deleted.cardOrder).toEqual([second]);
		expect(deleteCard(deleted, second)).toBe(deleted);
	});

	it("only switches to layouts that fit the content", () => {
		const document = deck();
		const title = document.cardOrder[0] ?? "";
		const card = document.cards[title];
		if (!card) throw new Error("fixture");
		expect(compatibleLayouts(card)).toContain("title");
		expect(compatibleLayouts(card)).not.toContain("bullets");
		expect(setLayout(document, title, "bullets")).toBe(document);
	});

	it("adds a fillable card and changes the theme", () => {
		const document = setTheme(addCard(deck(), null), "ember");
		const added = valid(document);
		expect(added.cardOrder).toHaveLength(3);
		expect(added.theme).toBe("ember");
	});

	it("keeps the takeaway in step with the heading", () => {
		const document = deck();
		const first = document.cardOrder[0] ?? "";
		const heading = document.cards[first]?.nodes[0]?.id ?? "";
		const synced = syncTakeaway(
			setNodeText(document, first, heading, [{ text: "Batteries win" }]),
			first,
		);
		expect(synced.cards[first]?.takeaway).toBe("Batteries win");
	});

	it("merges runs with identical marks", () => {
		expect(
			normalizeRuns([{ text: "a" }, { text: "" }, { text: "b" }, { text: "c", italic: true }]),
		).toEqual([{ text: "ab" }, { text: "c", italic: true }]);
	});
});
