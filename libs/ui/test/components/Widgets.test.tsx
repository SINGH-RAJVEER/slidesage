import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	assembleDocument,
	CARD_THEME_DEFINITIONS,
	type CardDocument,
	convertCards,
} from "@slidesage/cards";
import { fireEvent, render, within } from "@testing-library/react";
import { CardList } from "../CardList";

function widgetDeck(theme: CardDocument["theme"] = "paper"): CardDocument {
	const drafts = [
		{
			layout: "chart",
			nodes: [
				{ type: "heading", text: "Capacity tripled" },
				{
					type: "chart",
					kind: "column",
					size: "large",
					categories: ["2023", "2024", "2025"],
					series: [{ name: "Capacity", values: [12, 18, 36] }],
					suffix: " GW",
					caption: "Operator filings",
				},
				{ type: "callout", tone: "positive", text: "Growth **doubled** in 2025." },
			],
		},
		{
			layout: "dashboard",
			nodes: [
				{ type: "heading", text: "Quarter at a glance" },
				{
					type: "chart",
					kind: "donut",
					size: "medium",
					categories: ["Solar", "Wind", "Hydro"],
					series: [{ name: "Share", values: [50, 30, 20] }],
					suffix: "%",
				},
				{ type: "progress", size: "medium", items: [{ label: "Hiring plan", value: 72 }] },
				{
					type: "table",
					size: "full",
					columns: ["Region", "Sites"],
					rows: [
						["North", "4"],
						["South", "11"],
					],
				},
			],
		},
		{
			layout: "chart",
			nodes: [
				{ type: "heading", text: "Two sources" },
				{
					type: "chart",
					kind: "line",
					categories: ["Q1", "Q2", "Q3", "Q4"],
					series: [
						{ name: "Solar", values: [1, 2, 3, 5] },
						{ name: "Wind", values: [2, 2, 3, 4] },
					],
				},
			],
		},
	];
	const results = convertCards({
		operationId: "widgets",
		sourceIds: [],
		cards: drafts.map((draft, index) => ({
			position: index + 1,
			takeaway: `Point ${index + 1}`,
			role: "evidence",
			draft,
		})),
	});
	return assembleDocument({
		title: "Widgets",
		theme,
		cards: results.map((result) => {
			if (!("card" in result)) throw new Error(result.issue.message);
			return result.card;
		}),
	});
}

describe("widgets", () => {
	it("exposes the theme's chart colors to every card", () => {
		const view = render(<CardList document={widgetDeck("cobalt")} />);
		const [article] = view.getAllByRole("article");
		const chart = CARD_THEME_DEFINITIONS.cobalt.chart;
		expect(article?.style.getPropertyValue("--card-series-1")).toBe(chart.series[0] ?? "");
		expect(article?.style.getPropertyValue("--card-caution")).toBe(chart.caution);
	});

	it("names each chart, keeps its data in a table, and labels every widget", () => {
		const view = render(<CardList document={widgetDeck()} />);
		const column = view.getByRole("figure", { name: "Column chart of Capacity" });
		const data = within(column).getByRole("table");
		expect(within(data).getByRole("row", { name: "2025 36 GW" })).toBeInTheDocument();
		expect(within(column).getByText("Operator filings")).toBeInTheDocument();
		expect(view.getByRole("complementary", { name: "Positive" })).toHaveTextContent(
			"Growth doubled in 2025.",
		);
		// A donut lists its slices with values, and shares only where they differ; one series needs no legend.
		const donut = view.getByRole("figure", { name: "Donut chart of Share" });
		expect(within(donut).getAllByRole("listitem")[0]?.textContent).toBe("Solar50%");
		expect(view.getByLabelText("Hiring plan")).toHaveAttribute("value", "72");
		expect(view.getByRole("columnheader", { name: "Sites" })).toHaveClass("text-right");
		// Two series always get a legend.
		const line = view.getByRole("figure", { name: "Line chart of Solar, Wind" });
		expect(
			within(line)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Solar", "Wind"]);
	});

	it("places a sized chart beside its text and dashboard widgets in rows", () => {
		const view = render(<CardList document={widgetDeck()} />);
		const column = view.getByRole("figure", { name: "Column chart of Capacity" });
		expect(column.parentElement?.style.flexGrow).toStartWith("0.66");
		const donut = view.getByRole("figure", { name: "Donut chart of Share" });
		const meter = view.getByLabelText("Hiring plan");
		const table = view
			.getAllByRole("table")
			.find((element) => !element.classList.contains("sr-only"));
		const rowOf = (element: Element | null | undefined) =>
			element?.closest("[style]")?.parentElement;
		expect(rowOf(donut)).toBe(rowOf(meter));
		expect(rowOf(table)).not.toBe(rowOf(donut));
	});

	it("edits table cells and meter values in place", () => {
		let current = widgetDeck();
		const view = render(
			<CardList
				document={current}
				edit={(update) => {
					current = update(current);
				}}
			/>,
		);
		const [cell] = view.getAllByRole("textbox", { name: "Table cell" });
		if (!cell) throw new Error("no cell");
		cell.textContent = "East";
		fireEvent.input(cell);
		const percentage = view.getByRole("textbox", { name: "Meter percentage" });
		percentage.textContent = "85";
		fireEvent.input(percentage);
		const dashboard = current.cards[current.cardOrder[1] ?? ""];
		const table = dashboard?.nodes.find((node) => node.type === "table");
		const progress = dashboard?.nodes.find((node) => node.type === "progress");
		expect(table?.type === "table" && table.rows[0]?.cells[0]).toBe("East");
		expect(progress?.type === "progress" && progress.items[0]?.value).toBe(85);
	});
});

describe("chart plots", () => {
	const descriptors = {
		width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
		height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
	};
	const getComputedStyle = window.getComputedStyle;

	beforeEach(() => {
		Object.defineProperty(HTMLElement.prototype, "clientWidth", {
			configurable: true,
			get: () => 600,
		});
		Object.defineProperty(HTMLElement.prototype, "clientHeight", {
			configurable: true,
			get: () => 300,
		});
		// Container query units do not resolve here, so give charts a font size to lay out with.
		window.getComputedStyle = ((element: Element) =>
			new Proxy(getComputedStyle(element), {
				get(style, property) {
					if (property === "fontSize") return "16px";
					const value = Reflect.get(style, property, style);
					return typeof value === "function" ? value.bind(style) : value;
				},
			})) as typeof window.getComputedStyle;
	});

	afterEach(() => {
		if (descriptors.width)
			Object.defineProperty(HTMLElement.prototype, "clientWidth", descriptors.width);
		if (descriptors.height) {
			Object.defineProperty(HTMLElement.prototype, "clientHeight", descriptors.height);
		}
		window.getComputedStyle = getComputedStyle;
	});

	it("draws one labelled mark per value, in the series colors", () => {
		const view = render(<CardList document={widgetDeck()} />);
		const svgs = view.container.querySelectorAll("figure svg");
		const [column, donut, line] = Array.from(svgs);
		const filled = (svg: Element | undefined, tag: string, color: number) =>
			Array.from(svg?.querySelectorAll(tag) ?? []).filter(
				(mark) => mark.getAttribute("fill") === `var(--card-series-${color})`,
			);
		const bars = filled(column, "path", 1);
		expect(bars).toHaveLength(3);
		expect(Array.from(bars, (bar) => bar.querySelector("title")?.textContent)).toEqual([
			"2023 · Capacity: 12 GW",
			"2024 · Capacity: 18 GW",
			"2025 · Capacity: 36 GW",
		]);
		expect(column?.textContent).toContain("36 GW");
		expect(donut?.querySelectorAll("path")).toHaveLength(3);
		expect(donut?.querySelector("text")?.textContent).toBe("100%");
		expect(line?.querySelectorAll("circle")).toHaveLength(8);
		expect(filled(line, "circle", 2)).toHaveLength(4);
	});
});
