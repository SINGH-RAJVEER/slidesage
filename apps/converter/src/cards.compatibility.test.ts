import { describe, expect, it } from "bun:test";
import {
	CARD_TEMPLATES,
	type ConvertCardsRequest,
	cardToDraft,
	convertCards,
} from "@slidesage/cards";
import { handle as referenceHandle, SCHEMA_VERSION_HEADER } from "./handler";

async function response(body: unknown, raw?: string): Promise<Response> {
	const request = new Request("http://converter/v1/cards", {
		method: "POST",
		headers: { "Content-Type": "application/json", [SCHEMA_VERSION_HEADER]: "3" },
		body: raw ?? JSON.stringify(body),
	});
	const target = process.env["CONVERTER_UNDER_TEST_URL"];
	if (!target) return referenceHandle(request);
	const url = new URL(target);
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error("CONVERTER_UNDER_TEST_URL must be an HTTP test worker");
	return fetch(new URL("/v1/cards", url), {
		method: request.method,
		headers: request.headers,
		body: new ReadableStream({
			async start(controller) {
				const reader = request.body?.getReader();
				if (reader) {
					for (;;) {
						const next = await reader.read();
						if (next.done) break;
						controller.enqueue(next.value);
					}
				}
				controller.close();
			},
		}),
		redirect: "manual",
		signal: AbortSignal.timeout(5000),
	});
}

async function matches(body: unknown, raw?: string) {
	const expected = await referenceHandle(
		new Request("http://converter/v1/cards", {
			method: "POST",
			headers: { [SCHEMA_VERSION_HEADER]: "3" },
			body: raw ?? JSON.stringify(body),
		}),
	);
	const actual = await response(body, raw);
	expect(actual.status).toBe(expected.status);
	expect(actual.headers.get("content-type")).toBe(expected.headers.get("content-type"));
	expect(await actual.json()).toEqual(await expected.json());
}

const asset = "a".repeat(64);
const input = {
	position: 1,
	takeaway: "Storage lowers peak costs",
	role: "evidence",
	draft: {
		layout: "bullets",
		nodes: [
			{ type: "heading", text: "Storage cuts **peak** costs" },
			{ type: "bullets", items: ["Shifts load to *off-peak* hours", "Defers grid upgrades"] },
		],
		sourceIds: ["s1"],
	},
};
const valid = { operationId: "op-1", sourceIds: ["s1", "s2"], assetIds: [asset], cards: [input] };

function draft(nodes: unknown[], layout = "dashboard") {
	return { ...valid, cards: [{ ...input, draft: { layout, nodes } }] };
}

const nodes = [
	{ type: "heading", text: "Storage cuts **peak** costs" },
	{ type: "paragraph", text: "Text with *italic* and **bold**" },
	{ type: "bullets", items: ["First **point**", "Second"] },
	{ type: "quote", text: "Words", attribution: " <b>Author</b> " },
	{ type: "stat", value: "42", label: "Sites" },
	{ type: "steps", items: [{ title: "Plan", detail: "**Brief**" }, { title: "Build" }] },
	{
		type: "columns",
		columns: [
			{ heading: "Before", items: ["One", "Two"] },
			{ heading: "After", items: ["Three", "Four"] },
		],
	},
	{ type: "image", assetId: asset, alt: " <span>Racks</span> " },
	{
		type: "chart",
		kind: "column",
		categories: [2024, "2025"],
		series: [{ name: "Sites", values: ["1,200", "-3.5"] }],
		prefix: "$ ",
		suffix: " GW",
		caption: " <b>Growth</b> ",
	},
	{ type: "progress", items: [{ label: "Done", value: "52.5" }] },
	{
		type: "table",
		columns: ["Year", "Sites"],
		rows: [
			[2024, "1,200"],
			[2025, "More"],
		],
	},
	{ type: "callout", text: "**Read** the note" },
];

describe("native card conversion compatibility", () => {
	it("reuses deterministic conversion and emphasis assertions", async () => {
		const actual = await response(valid);
		expect(actual.status).toBe(200);
		const result = (await actual.json()) as {
			schemaVersion: number;
			results: ReturnType<typeof convertCards>;
		};
		expect(result).toEqual({
			schemaVersion: 3,
			results: convertCards(valid as ConvertCardsRequest),
		});
		const first = result.results[0];
		expect(first && "card" in first && first.card.nodes[0]).toMatchObject({
			type: "heading",
			text: [{ text: "Storage cuts " }, { text: "peak", bold: true }, { text: " costs" }],
		});
		expect(await (await response(valid)).json()).toEqual(result);
	});

	it("matches short emphasis combinations including unmatched split parts", async () => {
		const texts = [""];
		let level = [""];
		for (let length = 1; length <= 6; length++) {
			level = level.flatMap((prefix) => ["*", "a", " "].map((character) => prefix + character));
			texts.push(...level);
		}
		await matches({
			...valid,
			cards: texts.map((text, index) => ({
				...input,
				position: index + 1,
				draft: { layout: "title", nodes: [{ type: "heading", text }] },
			})),
		});
	});

	it("round trips every curated card including stored image assets", async () => {
		for (const template of CARD_TEMPLATES) {
			const cards = template.document.cardOrder.map((id, index) => {
				const card = template.document.cards[id];
				if (!card) throw new Error("Missing curated card");
				return {
					position: index + 1,
					takeaway: card.takeaway,
					role: card.role,
					draft: cardToDraft(card),
				};
			});
			await matches({
				operationId: template.id,
				sourceIds: ["s1", "s2", "s3"],
				assetIds: Object.keys(template.assets),
				cards,
			});
		}
	});

	it("matches all node readers, default sizes and feature layouts", async () => {
		for (const node of nodes) await matches(draft([node]));
		for (const layout of [
			"title",
			"statement",
			"bullets",
			"comparison",
			"process",
			"quote",
			"stats",
			"image-left",
			"image-right",
			"cover",
			"chart",
			"table",
			"dashboard",
			"unknown",
			null,
		]) {
			for (const node of nodes.slice(7)) {
				for (const size of [undefined, null, "small", "medium", "large", "full", "wrong"]) {
					await matches({
						...valid,
						cards: [{ ...input, draft: { layout, nodes: [{ ...node, size }] } }],
					});
				}
			}
		}
		await matches(draft([nodes[8], nodes[1]], "chart"));
		await matches(draft([nodes[10], nodes[2]], "table"));
		await matches(draft([nodes[8], nodes[11]], "chart"));
	});

	it("reuses widget numeric sizing and dashboard packing assertions", async () => {
		const chart = {
			type: "chart",
			kind: "column",
			categories: ["2023", "2024", "2025"],
			series: [{ name: "Capacity", values: [12, "18.5", "1,200"] }],
			suffix: " GW",
		};
		for (const includeText of [false, true]) {
			const request = draft([nodes[0], chart, ...(includeText ? [nodes[1]] : [])], "chart");
			await matches(request);
			const result = (await (await response(request)).json()) as {
				results: ReturnType<typeof convertCards>;
			};
			const first = result.results[0];
			if (!first || !("card" in first)) throw new Error("Expected widget card");
			expect(first.card.nodes.find((node) => node.type === "chart")).toMatchObject({
				size: includeText ? "large" : "full",
				series: [{ name: "Capacity", values: [12, 18.5, 1200] }],
				suffix: " GW",
			});
		}
		for (const sizes of [
			["small", "small", "small", "full"],
			["full", "large", "medium"],
		]) {
			await matches(
				draft([
					nodes[0],
					...sizes.map((size) => ({
						type: "progress",
						size,
						items: [{ label: "Done", value: 40 }],
					})),
				]),
			);
		}
		for (const kind of ["column", "bar", "stacked-column", "line", "area", "pie", "donut"]) {
			for (const values of [
				[1, 2],
				[1, -1],
				[0, 0],
			]) {
				for (const count of [1, 2])
					await matches(
						draft(
							[
								nodes[0],
								{
									type: "chart",
									kind,
									categories: ["A", "B"],
									series: Array.from({ length: count }, (_, i) => ({ name: String(i), values })),
								},
							],
							"chart",
						),
					);
			}
		}
	});

	it("keeps card issues independent and validates every request before converting", async () => {
		for (const body of [
			{},
			{ operationId: "\uFEFF" },
			{ ...valid, sourceIds: false },
			{ ...valid, sourceIds: [null] },
			{ ...valid, assetIds: false },
			{ ...valid, assetIds: [" "] },
			{ ...valid, cards: null },
			...[
				null,
				false,
				1,
				"card",
				[],
				{},
				{ position: 1 },
				{ ...input, position: 0 },
				{ ...input, position: 1.5 },
				{ ...input, position: null },
				{ ...input, role: "unknown" },
				{ ...input, takeaway: " " },
			].map((card) => ({ ...valid, cards: [card] })),
			{ ...valid, sourceIds: null, assetIds: null, cards: [] },
			{ ...valid, cards: [{ ...input, draft: null }, input, { ...input, draft: { nodes: [] } }] },
			{
				...valid,
				cards: [
					{ ...input, draft: null },
					{ ...input, position: 0 },
				],
			},
		])
			await matches(body);
	});

	it("matches first issue paths for malformed nested values", async () => {
		const malformed = [undefined, null, false, 1, "text", [], {}, [null]];
		for (const node of nodes) {
			for (const field of Object.keys(node)) {
				for (const value of malformed) await matches(draft([{ ...node, [field]: value }]));
			}
		}
		for (const value of malformed) {
			await matches({ ...valid, cards: [{ ...input, draft: value }] });
			await matches({ ...valid, cards: [{ ...input, draft: { nodes: value } }] });
		}
		for (const sourceIds of [null, "s1", ["s9"], [1], ["s1", "s1"], Array(9).fill("s1")]) {
			await matches({ ...valid, cards: [{ ...input, draft: { ...input.draft, sourceIds } }] });
		}
		await matches({
			...valid,
			assetIds: [],
			cards: [{ ...input, draft: { layout: "image-left", nodes: [nodes[7], nodes[0], nodes[1]] } }],
		});
	});

	it("preserves UTF16 hashes, text normalization, markup, affixes and numeric strings", async () => {
		for (const operationId of ["op-1", "😀", "\ud800", "a\u0301", "a\0:b", "null", " "])
			for (const position of [1, 2, 9007199254740992, 1e21, 1e100])
				await matches({ ...valid, operationId, cards: [{ ...input, position }] });
		for (const text of [
			"",
			" ",
			"x".repeat(91),
			"😀".repeat(90),
			"\ud800 café\udfff",
			"a\u0301",
			"<b>Hi</b>\u202e there\n\tfriend",
			"a<b and c>d",
			"**bold** *italic*",
			"***bold***",
			"**a* b**",
			"**bold **",
			"*a b *",
			"* spaced*",
			"***",
			"* spaced* **bold**",
			"**bold** * spaced*",
			"prefix * spaced*",
			"5 * 3 = 15",
			"** **",
			"****",
			"**a**b*c*",
		])
			await matches(draft([{ type: "heading", text }], "title"));
		for (const value of [
			"1,200",
			"-3.5",
			"1 2",
			"-0",
			"+1",
			".2",
			"2.",
			"1e2",
			"3 GW",
			"",
			"  ",
			"١",
			"9".repeat(400),
			"\uFEFF1\u00a02",
			null,
			true,
		]) {
			await matches(
				draft(
					[
						{
							type: "chart",
							kind: "column",
							categories: ["A"],
							series: [{ name: "S", values: [value] }],
						},
					],
					"chart",
				),
			);
			await matches(draft([{ type: "progress", items: [{ label: "P", value }] }]));
		}
		for (const affix of [" GW", "GW ", " <b>GW</b> ", "\u0085GW", "\uFEFF GW", "", "  ", null]) {
			await matches(draft([{ ...nodes[8], prefix: affix, suffix: affix }], "chart"));
		}
		await matches(
			null,
			'{"operationId":"x","cards":[{"position":1e999,"role":"opening","takeaway":"T"}]}',
		);
		await matches(
			null,
			'{"operationId":"x","cards":[{"position":1,"role":"opening","takeaway":"T","draft":{"layout":"chart","nodes":[{"type":"chart","kind":"column","categories":[1e999],"series":[{"name":"S","values":[1]}]}]}}]}',
		);
	});
});
