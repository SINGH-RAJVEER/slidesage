import { describe, expect, it } from "bun:test";
import {
	assembleDocument,
	type CardDocument,
	type ChartNode,
	convertCards,
	newWidgetCard,
} from "@slidesage/cards";
import { fireEvent, render, within } from "@testing-library/react";
import { CardToolbar, parseValue } from "../../components/Cards";
import { CardList } from "../CardList";

function deck(): CardDocument {
	const drafts = [
		{
			layout: "bullets",
			nodes: [
				{ type: "heading", text: "Why storage" },
				{ type: "bullets", items: ["Cheaper peaks", "Fewer outages"] },
			],
		},
		{
			layout: "bullets",
			nodes: [
				{ type: "heading", text: "Everything" },
				{ type: "bullets", items: ["One", "Two", "Three", "Four", "Five"] },
			],
		},
		{
			layout: "chart",
			nodes: [
				{ type: "heading", text: "Capacity" },
				{
					type: "chart",
					kind: "column",
					categories: ["2024", "2025"],
					series: [{ name: "Capacity", values: [12, 18] }],
				},
			],
		},
	];
	const results = convertCards({
		operationId: "widget-editing",
		sourceIds: [],
		cards: drafts.map((draft, index) => ({
			position: index + 1,
			takeaway: `Point ${index + 1}`,
			role: "evidence",
			draft,
		})),
	});
	return assembleDocument({
		title: "Editing",
		theme: "slate",
		cards: results.map((result) => {
			if (!("card" in result)) throw new Error(result.issue.message);
			return result.card;
		}),
	});
}

function chartOf(document: CardDocument, cardId: string): ChartNode {
	const node = document.cards[cardId]?.nodes.find((entry) => entry.type === "chart");
	if (node?.type !== "chart") throw new Error("no chart");
	return node;
}

describe("inserting widgets", () => {
	it("adds a chart beside a card's text, or a new widget card after it", () => {
		let current = deck();
		const [bullets, crowded] = current.cardOrder;
		if (!bullets || !crowded) throw new Error("no cards");
		const open = (cardId: string) => {
			const view = render(
				<CardToolbar
					document={current}
					cardId={cardId}
					edit={(update) => {
						current = update(current);
					}}
				/>,
			);
			fireEvent.pointerDown(view.getByRole("button", { name: "Insert a widget" }), { button: 0 });
			return view;
		};
		let view = open(crowded);
		// Five bullets leave no room for a chart beside them.
		expect(view.getByRole("menuitem", { name: "Chart" })).toHaveAttribute("data-disabled");
		view.unmount();
		view = open(bullets);
		fireEvent.click(view.getByRole("menuitem", { name: "Chart" }));
		expect(current.cards[bullets]?.layout).toBe("chart");
		view.unmount();
		view = open(bullets);
		fireEvent.click(view.getByRole("menuitem", { name: "Dashboard card" }));
		const added = current.cards[current.cardOrder[1] ?? ""];
		expect(added?.layout).toBe("dashboard");
	});
});

describe("widget controls", () => {
	it("offers removal only where the layout still holds the rest", () => {
		const base = deck();
		const dashboard = newWidgetCard("dashboard");
		const document = { ...base, cards: { ...base.cards, [dashboard.id]: dashboard } };
		document.cardOrder = [...base.cardOrder, dashboard.id];
		const view = render(<CardList document={document} edit={() => {}} />);
		const [, , chartCard, dashboardCard] = view.getAllByRole("article");
		if (!chartCard || !dashboardCard) throw new Error("no cards");
		const chartControls = within(chartCard).getByRole("toolbar", { name: "Chart controls" });
		expect(within(chartControls).queryByRole("button", { name: "Remove chart" })).toBeNull();
		// A chart card's chart fills the card alone, so its size is not offered.
		expect(within(chartControls).queryByRole("button", { name: "Widget size" })).toBeNull();
		// A dashboard needs two widgets, and has exactly two.
		expect(within(dashboardCard).queryByRole("button", { name: "Remove chart" })).toBeNull();
		expect(within(dashboardCard).getAllByRole("button", { name: "Widget size" })).toHaveLength(2);
	});

	it("edits chart data in a grid and refuses values that are not numbers", () => {
		let current = deck();
		const cardId = current.cardOrder[2] ?? "";
		const view = render(
			<CardList
				document={current}
				edit={(update) => {
					current = update(current);
				}}
			/>,
		);
		fireEvent.click(view.getByRole("button", { name: "Edit chart data" }));
		const dialog = view.getByRole("dialog", { name: "Chart data" });
		const value = within(dialog).getByRole("textbox", { name: "Capacity in 2025" });
		fireEvent.change(value, { target: { value: "lots" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Save data" }));
		expect(within(dialog).getByRole("alert")).toHaveTextContent(
			"“lots” for Capacity in 2025 is not a number.",
		);
		expect(chartOf(current, cardId).series[0]?.values).toEqual([12, 18]);
		fireEvent.change(value, { target: { value: "1,250.5" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Add series" }));
		fireEvent.click(within(dialog).getByRole("button", { name: "Add category" }));
		fireEvent.change(within(dialog).getByRole("textbox", { name: "Category 3" }), {
			target: { value: "2026" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Save data" }));
		const chart = chartOf(current, cardId);
		expect(chart.categories).toEqual(["2024", "2025", "2026"]);
		expect(chart.series.map((series) => [series.name, series.values])).toEqual([
			["Capacity", [12, 1250.5, 0]],
			["Series 2", [0, 0, 0]],
		]);
	});

	it("reads typed numbers with separators and minus signs", () => {
		expect(parseValue("1,200")).toBe(1200);
		expect(parseValue("−3.5")).toBe(-3.5);
		expect(parseValue("4%")).toBeNull();
	});
});
