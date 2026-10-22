import type { CardDraftInput } from "@slidesage/cards";

/**
 * Drafts and mutations shared by the differential compatibility tests, which
 * send the same requests to this converter and to the one named by
 * CONVERTER_UNDER_TEST_URL and require byte-identical answers.
 */

export const ASSET = "a".repeat(64);
export const OTHER_ASSET = "b".repeat(64);

// A 1x1 PNG.
export const PIXEL =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==";

function card(
	position: number,
	layout: string,
	nodes: unknown[],
	extra: object = {},
): CardDraftInput {
	return {
		position,
		takeaway: `Card ${position}`,
		role: "evidence",
		draft: { layout, nodes, ...extra },
	};
}

const image = { type: "image", assetId: ASSET, alt: "Battery warehouse", fit: "cover" };
const longItem = "A long point that fills the line and wraps onto the next one "
	.repeat(3)
	.slice(0, 150);

/** One draft of every layout and widget, with text long enough to wrap and shrink. */
export function deckDrafts(): CardDraftInput[] {
	return [
		card(1, "title", [
			{ type: "heading", text: "Grid storage" },
			{ type: "paragraph", text: "Why **batteries** matter, and *why now*" },
		]),
		card(2, "statement", [
			{ type: "heading", text: "Storage is the bottleneck" },
			{ type: "paragraph", text: "Renewables need somewhere to put the surplus." },
			{ type: "paragraph", text: "Without it, curtailment wastes **cheap** power." },
		]),
		card(
			3,
			"bullets",
			[
				{ type: "heading", text: "Costs fell" },
				{
					type: "bullets",
					items: ["Cells got cheaper", "Factories *scaled*", "Supply chains matured"],
				},
				{ type: "paragraph", text: "Prices fell ninety percent in a decade." },
			],
			{ sourceIds: ["s1", "s2", "s3"], notes: "Mention the 2023 report." },
		),
		card(4, "comparison", [
			{ type: "heading", text: "Lithium or iron" },
			{
				type: "columns",
				columns: [
					{ heading: "Lithium", items: ["Dense", "Costly", "Proven"] },
					{ heading: "Iron", items: ["Heavy", "Cheap"] },
					{ heading: "Sodium", items: ["New", "Promising"] },
				],
			},
		]),
		card(5, "process", [
			{ type: "heading", text: "How a site is built" },
			{
				type: "steps",
				items: [
					{ title: "Survey", detail: "Find grid capacity" },
					{ title: "Permit" },
					{ title: "Build", detail: "Install **containers** and inverters" },
					{ title: "Connect" },
				],
			},
		]),
		card(6, "quote", [
			{ type: "heading", text: "In their words" },
			{ type: "quote", text: "Storage is the new baseload.", attribution: "An engineer" },
		]),
		card(7, "stats", [
			{ type: "heading", text: "By the numbers" },
			{ type: "stat", value: "90%", label: "Cost drop since 2010" },
			{ type: "stat", value: "4h", label: "Typical duration" },
			{ type: "stat", value: "$3.1B", label: "Invested last year" },
			{ type: "paragraph", text: "Figures from the 2023 survey." },
		]),
		card(8, "image-left", [
			image,
			{ type: "heading", text: "Warehouses of cells" },
			{ type: "paragraph", text: "They back up whole grids." },
		]),
		card(9, "image-right", [
			{ ...image, fit: "contain", focus: { x: 0.2, y: 0.8 } },
			{ type: "heading", text: "Close to demand" },
			{ type: "bullets", items: ["Near cities", "Near substations"] },
		]),
		card(10, "cover", [
			{ ...image, focus: { x: 0.3, y: 0.1 } },
			{ type: "heading", text: "What comes next" },
			{ type: "paragraph", text: "A decade of buildout" },
		]),
		card(11, "bullets", [
			{ type: "heading", text: "Everything at once" },
			{ type: "bullets", items: Array.from({ length: 6 }, () => longItem) },
			{ type: "paragraph", text: longItem.repeat(3).slice(0, 400) },
		]),
		card(12, "chart", [
			{ type: "heading", text: "Capacity by year" },
			{
				type: "chart",
				kind: "column",
				categories: ["2020", 2021, "2022", "2023"],
				series: [{ name: "Capacity", values: [1.5, "2,400", 3, "4.25"] }],
				prefix: "$ ",
				suffix: " GW",
				caption: "Source: national grid operator",
			},
			{ type: "paragraph", text: "Capacity **doubled** every two years." },
		]),
		card(13, "chart", [
			{ type: "heading", text: "Where it goes" },
			{
				type: "chart",
				kind: "bar",
				size: "full",
				categories: ["Utility scale projects", "Homes", "Businesses"],
				series: [{ name: "Share", values: [62, 23, 15] }],
				suffix: "%",
			},
			{ type: "callout", tone: "positive", text: "Utilities lead adoption." },
		]),
		card(14, "chart", [
			{ type: "heading", text: "Mix over time" },
			{
				type: "chart",
				kind: "stacked-column",
				categories: ["2021", "2022", "2023"],
				series: [
					{ name: "Lithium", values: [10, 14, 20] },
					{ name: "Iron", values: [2, 3, -1] },
				],
			},
			{ type: "bullets", items: ["Lithium dominates", "Iron is rising"] },
		]),
		card(15, "chart", [
			{ type: "heading", text: "Prices" },
			{
				type: "chart",
				kind: "line",
				size: "large",
				categories: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9"],
				series: [
					{ name: "Cells", values: [140, 132, 128, 120, 115, 110, 0, 101, 98] },
					{ name: "Packs", values: [180, 170, 166, 158, 150, 145, 140, 133, 128] },
				],
				prefix: "$",
			},
		]),
		card(16, "chart", [
			{ type: "heading", text: "Stored energy" },
			{
				type: "chart",
				kind: "area",
				size: "small",
				categories: ["Mon", "Tue", "Wed"],
				series: [{ name: "GWh", values: [0.5, 1.25, 0.75] }],
			},
			{ type: "paragraph", text: "Peaks mid-week." },
		]),
		card(17, "chart", [
			{ type: "heading", text: "Market share" },
			{
				type: "chart",
				kind: "pie",
				categories: ["A", "B", "C", "D"],
				series: [{ name: "Share", values: [40, 30, 20, 10] }],
			},
		]),
		card(18, "chart", [
			{ type: "heading", text: "Total" },
			{
				type: "chart",
				kind: "donut",
				size: "medium",
				categories: ["Used", "Spare"],
				series: [{ name: "Capacity", values: [75, 0] }],
				caption: "Fleet data",
			},
			{ type: "callout", tone: "caution", text: "Spare capacity is *thin*." },
		]),
		card(19, "table", [
			{ type: "heading", text: "Chemistries compared" },
			{
				type: "table",
				columns: ["Chemistry", "Cost", "Density", "Notes"],
				rows: [
					["Lithium", "$140", "250 Wh/kg", "Common"],
					["Iron", "$90", "160 Wh/kg", ""],
					["Sodium", 80, "1,200", "New"],
				],
			},
			{ type: "paragraph", text: "Costs per kilowatt hour." },
		]),
		card(20, "table", [
			{ type: "heading", text: "Plain table" },
			{
				type: "table",
				size: "full",
				columns: ["Site", "Status"],
				rows: [["North", "Live"]],
			},
		]),
		card(21, "dashboard", [
			{ type: "heading", text: "Fleet dashboard" },
			{
				type: "chart",
				kind: "column",
				size: "medium",
				categories: ["A", "B"],
				series: [{ name: "Output", values: [3, 5] }],
			},
			{
				type: "progress",
				size: "medium",
				items: [
					{ label: "Charged", value: 80 },
					{ label: "Healthy", value: "97.5" },
					{ label: "Idle", value: 0 },
				],
			},
			{ type: "callout", size: "small", text: "All sites reporting." },
			{
				type: "table",
				size: "large",
				columns: ["Site", "MW"],
				rows: [
					["North", "120"],
					["South", "80"],
				],
			},
		]),
		card(22, "dashboard", [
			{ type: "heading", text: "Two widgets" },
			{ type: "progress", size: "full", items: [{ label: "Done", value: 50 }] },
			{ type: "callout", size: "full", tone: "caution", text: "Behind schedule." },
		]),
	];
}

/** Values that probe coercion, Unicode, and limits wherever one is placed. */
export const TRICKY_VALUES: unknown[] = [
	null,
	true,
	false,
	0,
	-0,
	1,
	-1,
	1.5,
	1e21,
	1e300,
	-1e13,
	5e-324,
	"",
	" ",
	"  ﻿",
	"0",
	"1,200",
	" -3.5 ",
	"12 GW",
	"1e3",
	"x",
	"**bold** and *it*",
	"***",
	"****",
	"* not italic *",
	"a**b**c*d*e",
	"<b>tag</b> <script src='x'>z</script> a<b and c>d <IMG SRC=x>",
	"control\u0000\u0007\u001f\u007f\u0085 chars",
	"zero​width‮bidi⁦",
	"café NFD",
	"\ud800 lone",
	"\udc00",
	"line\nbreak",
	"two\n\nbreaks and a\r\nwindows one",
	"trailing break\n",
	"carriage\ronly",
	"emoji \u{1f680} and \u{1f469}‍\u{1f4bb}",
	"中文字符和日本語のテキスト",
	"x".repeat(17),
	"y".repeat(61),
	"z".repeat(161),
	"w".repeat(421),
	"s1",
	"s999",
	"s1000",
	"n_abcdef",
	"N_abcdef",
	ASSET,
	OTHER_ASSET,
	"heading",
	"paragraph",
	"chart",
	"pie",
	"full",
	"small",
	"caution",
	"constructor",
	"__proto__",
	"toString",
	[],
	[1],
	["a", "b"],
	[null],
	[[]],
	{},
	{ toString: 1 },
	{ x: 0.5, y: 0.5 },
	{ x: 2, y: -1 },
	{ text: "run" },
	{ text: "run", bold: true, italic: true },
	{ text: "", bold: false },
];

/** A small deterministic generator, so a failure names a reproducible case. */
export function random(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

type Container = Record<string, unknown> | unknown[];

function containers(value: unknown, found: Container[] = []): Container[] {
	if (Array.isArray(value)) {
		found.push(value);
		for (const item of value) containers(item, found);
	} else if (typeof value === "object" && value !== null) {
		found.push(value as Record<string, unknown>);
		for (const item of Object.values(value)) containers(item, found);
	}
	return found;
}

/**
 * Returns a copy of value with one random change: a member replaced by a
 * tricky value, removed, added, duplicated, or reordered.
 */
export function mutate<T>(value: T, next: () => number): T {
	const copy = structuredClone(value);
	const targets = containers(copy);
	const target = targets[Math.floor(next() * targets.length)];
	if (!target) return copy;
	const pick = () => TRICKY_VALUES[Math.floor(next() * TRICKY_VALUES.length)];
	const choice = next();
	if (Array.isArray(target)) {
		if (target.length === 0 || choice < 0.15) target.push(pick());
		else if (choice < 0.3) target.splice(Math.floor(next() * target.length), 1);
		else if (choice < 0.4) target.push(target[Math.floor(next() * target.length)]);
		else if (choice < 0.5) target.reverse();
		else target[Math.floor(next() * target.length)] = pick();
		return copy;
	}
	const keys = Object.keys(target);
	if (keys.length === 0 || choice < 0.15) {
		const names = ["type", "text", "id", "size", "kind", "tone", "extra", "notes", "detail", "1"];
		target[names[Math.floor(next() * names.length)] ?? "extra"] = pick();
	} else if (choice < 0.35) {
		delete target[keys[Math.floor(next() * keys.length)] ?? ""];
	} else {
		target[keys[Math.floor(next() * keys.length)] ?? ""] = pick();
	}
	return copy;
}
