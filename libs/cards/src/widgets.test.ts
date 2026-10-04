import { describe, expect, it } from "bun:test";
import { assembleDocument, convertCards } from "./convert";
import { cardToDraft } from "./draft-format";
import {
	addListItem,
	addWidget,
	canAddWidget,
	compatibleSizes,
	duplicateCard,
	newWidgetCard,
	removeWidget,
	setChartData,
	setChartKind,
	setMeter,
	setTableCell,
	setWidgetSize,
} from "./edit";
import type { Card, CardDocument, ChartNode } from "./schema";
import { validateCardDocument } from "./validate";
import { axisTicks, compatibleChartKinds, formatChartValue, widgetRows } from "./widgets";

const chartDraft = {
	layout: "chart",
	nodes: [
		{ type: "heading", text: "Storage capacity tripled" },
		{
			type: "chart",
			kind: "column",
			categories: ["2023", "2024", "2025"],
			series: [{ name: "Capacity", values: [12, "18.5", "1,200"] }],
			suffix: " GW",
			caption: "Grid operator filings",
		},
		{ type: "paragraph", text: "Most of the growth came in **2025**." },
	],
};

function convert(draft: unknown, position = 1) {
	const [result] = convertCards({
		operationId: "widgets",
		sourceIds: [],
		cards: [{ position, takeaway: "Storage grew", role: "evidence", draft }],
	});
	if (!result) throw new Error("no result");
	return result;
}

function card(draft: unknown, position = 1): Card {
	const result = convert(draft, position);
	if (!("card" in result)) throw new Error(JSON.stringify(result.issue));
	return result.card;
}

function deck(...cards: Card[]): CardDocument {
	return assembleDocument({ title: "Widgets", theme: "slate", cards });
}

function chartOf(document: CardDocument, cardId: string): ChartNode {
	const node = document.cards[cardId]?.nodes.find((entry) => entry.type === "chart");
	if (node?.type !== "chart") throw new Error("no chart");
	return node;
}

describe("drafted widgets", () => {
	it("converts a chart, reading numeric strings and sizing it beside its text", () => {
		const converted = card(chartDraft);
		const chart = converted.nodes.find((node) => node.type === "chart");
		expect(chart).toMatchObject({
			kind: "column",
			size: "large",
			categories: ["2023", "2024", "2025"],
			series: [{ name: "Capacity", values: [12, 18.5, 1200] }],
			suffix: " GW",
		});
		const alone = card({ ...chartDraft, nodes: chartDraft.nodes.slice(0, 2) });
		expect(alone.nodes.find((node) => node.type === "chart")).toMatchObject({ size: "full" });
	});

	it("reports charts whose data does not suit their kind or categories", () => {
		const twoSeriesPie = convert({
			layout: "chart",
			nodes: [
				{ type: "heading", text: "Mix" },
				{
					type: "chart",
					kind: "pie",
					categories: ["Solar", "Wind"],
					series: [
						{ name: "2024", values: [1, 2] },
						{ name: "2025", values: [2, 3] },
					],
				},
			],
		});
		expect("issue" in twoSeriesPie && twoSeriesPie.issue.message).toContain("exactly one series");
		const short = convert({
			layout: "chart",
			nodes: [
				{ type: "heading", text: "Mix" },
				{
					type: "chart",
					kind: "line",
					categories: ["A", "B", "C"],
					series: [{ name: "x", values: [1, 2] }],
				},
			],
		});
		expect("issue" in short && short.issue.message).toContain("one value per category");
		const units = convert({
			layout: "chart",
			nodes: [
				{ type: "heading", text: "Mix" },
				{
					type: "chart",
					kind: "line",
					categories: ["A", "B"],
					series: [{ name: "x", values: ["4%", 2] }],
				},
			],
		});
		expect("issue" in units && units.issue.message).toBe("must be a number without units");
	});

	it("packs dashboard widgets into at most two rows", () => {
		const dashboard = (sizes: string[]) =>
			convert({
				layout: "dashboard",
				nodes: [
					{ type: "heading", text: "Status" },
					...sizes.map((size) => ({
						type: "progress",
						size,
						items: [{ label: "Done", value: 40 }],
					})),
				],
			});
		expect("card" in dashboard(["small", "small", "small", "full"])).toBe(true);
		const tooTall = dashboard(["full", "large", "medium"]);
		expect("issue" in tooTall && tooTall.issue.message).toContain("2 rows");
		const sized = (sizes: ("small" | "medium" | "large" | "full")[]) =>
			widgetRows(sizes.map((size) => ({ size }))).map((row) =>
				row.map((cell) => Number(cell.width.toFixed(2))),
			);
		expect(sized(["large", "small", "medium", "medium"])).toEqual([
			[0.67, 0.33],
			[0.5, 0.5],
		]);
		expect(sized(["small", "large", "large"])).toEqual([[0.33, 0.67], [1]]);
	});

	it("round-trips every widget through the draft format", () => {
		const converted = card({
			layout: "dashboard",
			nodes: [
				{ type: "heading", text: "Quarter at a glance" },
				{ type: "progress", size: "small", items: [{ label: "Hiring", value: 80 }] },
				{
					type: "table",
					size: "large",
					columns: ["Region", "Sites"],
					rows: [
						["North", 4],
						["South", ""],
					],
				},
				{ type: "callout", size: "full", tone: "caution", text: "Supply is **tight**." },
			],
		});
		const draft = cardToDraft(converted);
		expect(draft.nodes).toEqual([
			{ type: "heading", text: "Quarter at a glance" },
			{ type: "progress", size: "small", items: [{ label: "Hiring", value: 80 }] },
			{
				type: "table",
				size: "large",
				columns: ["Region", "Sites"],
				rows: [
					["North", "4"],
					["South", ""],
				],
			},
			{ type: "callout", size: "full", tone: "caution", text: "Supply is **tight**." },
		]);
		const again = card({ layout: draft.layout, nodes: draft.nodes });
		expect(cardToDraft(again).nodes).toEqual(draft.nodes);
	});
});

describe("widget edits", () => {
	it("offers only the chart kinds the data suits", () => {
		const single = { categories: ["A", "B"], series: [{ id: "i_a", name: "x", values: [1, 2] }] };
		expect(compatibleChartKinds(single)).toEqual(["column", "bar", "line", "area", "pie", "donut"]);
		const double = {
			...single,
			series: [...single.series, { id: "i_b", name: "y", values: [3, -1] }],
		};
		expect(compatibleChartKinds(double)).toEqual([
			"column",
			"bar",
			"stacked-column",
			"line",
			"area",
		]);
	});

	it("switches a pie to a kind that suits new data and keeps the document valid", () => {
		const document = deck(card(chartDraft));
		const cardId = document.cardOrder[0] ?? "";
		const chartId = chartOf(document, cardId).id;
		const pie = setChartKind(document, cardId, chartId, "pie");
		expect(chartOf(pie, cardId).kind).toBe("pie");
		const existing = chartOf(pie, cardId).series[0];
		const twoSeries = setChartData(pie, cardId, chartId, {
			categories: ["2023", "2024", "2025"],
			series: [
				{ id: existing?.id, name: "Capacity", values: [1, 2, 3] },
				{ name: "Demand", values: [2, 3, 4] },
			],
			prefix: " ",
		});
		const chart = chartOf(twoSeries, cardId);
		expect(chart.kind).toBe("column");
		expect(chart.series[0]?.id).toBe(existing?.id);
		expect(chart.prefix).toBeUndefined();
		expect(setChartKind(twoSeries, cardId, chartId, "pie")).toBe(twoSeries);
		expect(validateCardDocument(twoSeries).ok).toBe(true);
	});

	it("adds widgets to the layout that holds them, or leaves the card alone", () => {
		const bullets = card({
			layout: "bullets",
			nodes: [
				{ type: "heading", text: "Why storage" },
				{ type: "bullets", items: ["Cheaper peaks", "Fewer outages"] },
			],
		});
		const crowded = card(
			{
				layout: "bullets",
				nodes: [
					{ type: "heading", text: "Why storage" },
					{ type: "bullets", items: ["One", "Two", "Three", "Four", "Five"] },
				],
			},
			2,
		);
		const document = deck(bullets, crowded);
		const withChart = addWidget(document, bullets.id, "chart");
		expect(withChart.cards[bullets.id]?.layout).toBe("chart");
		expect(chartOf(withChart, bullets.id).size).toBe("large");
		expect(canAddWidget(crowded, "chart")).toBe(false);
		expect(addWidget(document, crowded.id, "chart")).toBe(document);
		expect(validateCardDocument(withChart).ok).toBe(true);
	});

	it("resizes, edits, and removes dashboard widgets only within the layout's rules", () => {
		let document = deck(newWidgetCard("dashboard"));
		const cardId = document.cardOrder[0] ?? "";
		const [, chart, progress] = document.cards[cardId]?.nodes ?? [];
		if (chart?.type !== "chart" || progress?.type !== "progress") throw new Error("dashboard");
		document = addWidget(document, cardId, "callout");
		document = addWidget(document, cardId, "table");
		expect(document.cards[cardId]?.nodes).toHaveLength(5);
		// A fifth widget does not fit; the card is unchanged.
		expect(addWidget(document, cardId, "callout")).toBe(document);
		const current = document.cards[cardId] as Card;
		expect(compatibleSizes(current, chart.id)).not.toContain("full");
		expect(setWidgetSize(document, cardId, chart.id, "full")).toBe(document);
		document = setMeter(document, cardId, progress.id, progress.items[0]?.id ?? "", { value: 140 });
		document = addListItem(document, cardId, progress.id);
		const meters = document.cards[cardId]?.nodes.find((node) => node.id === progress.id);
		expect(meters?.type === "progress" && meters.items.map((meter) => meter.value)).toEqual([
			100, 30, 50,
		]);
		const table = document.cards[cardId]?.nodes.find((node) => node.type === "table");
		if (table?.type !== "table") throw new Error("table");
		document = setTableCell(document, cardId, table.id, null, 0, "Plan");
		document = setTableCell(document, cardId, table.id, table.rows[0]?.id ?? "", 1, "Ready");
		const edited = document.cards[cardId]?.nodes.find((node) => node.id === table.id);
		expect(edited?.type === "table" && [edited.columns[0], edited.rows[0]?.cells[1]]).toEqual([
			"Plan",
			"Ready",
		]);
		document = removeWidget(document, cardId, chart.id);
		document = removeWidget(document, cardId, progress.id);
		document = removeWidget(document, cardId, table.id);
		// Two widgets is the minimum, so the last removal is refused.
		expect(document.cards[cardId]?.nodes.filter((node) => node.type !== "heading")).toHaveLength(2);
		expect(validateCardDocument(document).ok).toBe(true);
	});

	it("gives a duplicated widget card fresh IDs for its series, meters, and rows", () => {
		const document = deck(newWidgetCard("dashboard"), newWidgetCard("table"));
		let copied = document;
		for (const id of document.cardOrder) copied = duplicateCard(copied, id);
		expect(copied.cardOrder).toHaveLength(4);
		expect(validateCardDocument(copied).ok).toBe(true);
	});
});

describe("chart scales", () => {
	it("chooses round ticks covering zero and every value", () => {
		expect(axisTicks([12, 18, 26])).toEqual([0, 10, 20, 30]);
		expect(axisTicks([-40, 75])).toEqual([-50, 0, 50, 100]);
		expect(axisTicks([0.2, 0.9])).toEqual([0, 0.25, 0.5, 0.75, 1]);
		expect(axisTicks([0])).toEqual([0, 1]);
	});

	it("formats values with their prefix, suffix, and sign", () => {
		expect(formatChartValue(1200, { prefix: "$", suffix: "M" })).toBe("$1,200M");
		expect(formatChartValue(-3.25, { suffix: "%" })).toBe("−3.25%");
		expect(formatChartValue(18.5, {})).toBe("18.5");
	});
});
