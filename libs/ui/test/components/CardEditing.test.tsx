import { describe, expect, it } from "bun:test";
import { assembleDocument, type CardDocument, convertCards } from "@slidesage/cards";
import { fireEvent, render } from "@testing-library/react";
import { CardToolbar } from "../../components/Cards";
import { CardList } from "../CardList";

/** A deck with every text-bearing node type. */
export function everyNodeDeck(): CardDocument {
	const drafts = [
		{
			layout: "title",
			nodes: [
				{ type: "heading", text: "Grid **storage**" },
				{ type: "paragraph", text: "A *short* intro" },
			],
		},
		{
			layout: "bullets",
			nodes: [
				{ type: "heading", text: "Reasons" },
				{ type: "bullets", items: ["Cheaper", "**Faster**"] },
			],
		},
		{
			layout: "comparison",
			nodes: [
				{ type: "heading", text: "Options" },
				{
					type: "columns",
					columns: [
						{ heading: "Lithium", items: ["Fast", "Short"] },
						{ heading: "Hydro", items: ["Long", "Rare"] },
					],
				},
			],
		},
		{
			layout: "process",
			nodes: [
				{ type: "heading", text: "Cycle" },
				{
					type: "steps",
					items: [
						{ title: "Charge", detail: "At *noon*" },
						{ title: "Hold" },
						{ title: "Discharge", detail: "At dusk" },
					],
				},
			],
		},
		{
			layout: "quote",
			nodes: [{ type: "quote", text: "Storage is **the** piece", attribution: "An operator" }],
		},
		{
			layout: "stats",
			nodes: [
				{ type: "heading", text: "Figures" },
				{ type: "stat", value: "-89%", label: "Price" },
				{ type: "stat", value: "42 GW", label: "Added" },
			],
		},
	];
	const results = convertCards({
		operationId: "every-node",
		sourceIds: [],
		cards: drafts.map((draft, index) => ({
			position: index + 1,
			takeaway: `Point ${index + 1}`,
			role: "evidence",
			draft,
		})),
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

describe("editing cards", () => {
	it("makes no edit when fields are focused and left unchanged", () => {
		const original = everyNodeDeck();
		let edits = 0;
		const view = render(
			<CardList
				document={original}
				edit={() => {
					edits += 1;
				}}
			/>,
		);
		for (const field of view.getAllByRole("textbox")) {
			fireEvent.focus(field);
			fireEvent.blur(field);
		}
		expect(edits).toBe(0);
	});

	it("leaves every node type unchanged when its fields are focused and left", () => {
		const original = everyNodeDeck();
		let current = original;
		const view = render(
			<CardList
				document={original}
				edit={(update) => {
					current = update(current);
				}}
			/>,
		);
		const fields = view.getAllByRole("textbox");
		// Every heading, paragraph, bullet, column heading and item, step title
		// and detail, quotation, attribution, figure, and label is editable.
		expect(fields.length).toBeGreaterThanOrEqual(24);
		for (const field of fields) {
			fireEvent.focus(field);
			fireEvent.blur(field);
		}
		// Headings resynchronise takeaways; nothing else may differ.
		const withoutTakeaways = (document: CardDocument) =>
			JSON.stringify({
				...document,
				cards: Object.fromEntries(
					Object.entries(document.cards).map(([id, card]) => [id, { ...card, takeaway: "" }]),
				),
			});
		expect(withoutTakeaways(current)).toBe(withoutTakeaways(original));
	});

	it("applies typed text to the node it belongs to", () => {
		const original = everyNodeDeck();
		let current = original;
		const view = render(
			<CardList
				document={original}
				edit={(update) => {
					current = update(current);
				}}
			/>,
		);
		const [heading] = view.getAllByRole("textbox", { name: "Card heading" });
		if (!heading) throw new Error("no heading");
		heading.innerHTML = "Grid <strong>batteries</strong>";
		fireEvent.input(heading);
		const first = current.cards[current.cardOrder[0] ?? ""];
		expect(first?.nodes[0]).toMatchObject({
			text: [{ text: "Grid " }, { text: "batteries", bold: true }],
		});
		expect(first?.takeaway).toBe("Grid batteries");
	});

	it("offers actions for one card, and only the moves its position allows", () => {
		const document = everyNodeDeck();
		const [first] = document.cardOrder;
		if (!first) throw new Error("no card");
		const view = render(<CardToolbar document={document} cardId={first} edit={() => {}} />);
		expect(view.getByRole("toolbar", { name: "Card 1 actions" })).toBeInTheDocument();
		expect(view.getByRole("button", { name: "Move card left" })).toBeDisabled();
		expect(view.getByRole("button", { name: "Move card right" })).toBeEnabled();
		expect(view.queryByRole("button", { name: "Delete card" })).toBeNull();
	});
});
