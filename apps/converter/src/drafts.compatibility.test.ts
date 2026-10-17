import { describe, expect, it } from "bun:test";
import {
	assembleDocument,
	CARD_TEMPLATES,
	type CardDocument,
	cardToDraft,
	convertCards,
	parseCardDocument,
} from "@slidesage/cards";
import { handle as referenceHandle, SCHEMA_VERSION_HEADER } from "./handler";

async function send(body: string, version: string | null = "3", method = "POST") {
	const request = new Request("http://converter/v1/documents/drafts", {
		method,
		headers: version === null ? {} : { [SCHEMA_VERSION_HEADER]: version },
		body: method === "POST" ? body : undefined,
	});
	const target = process.env["CONVERTER_UNDER_TEST_URL"];
	if (!target) return referenceHandle(request);
	return fetch(new URL("/v1/documents/drafts", target), {
		method,
		headers: request.headers,
		body: request.body,
		redirect: "manual",
		signal: AbortSignal.timeout(5000),
	});
}

async function compare(body: string) {
	const expected = await referenceHandle(
		new Request("http://converter/v1/documents/drafts", {
			method: "POST",
			headers: { [SCHEMA_VERSION_HEADER]: "3" },
			body,
		}),
	);
	const actual = await send(body);
	expect(actual.status).toBe(expected.status);
	expect(actual.headers.get("Content-Type")).toBe("application/json;charset=utf-8");
	const result = await actual.json();
	expect(result).toEqual(await expected.json());
	return result as { cards: Record<string, unknown> };
}

const asset = "a".repeat(64);
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing draft fixture value");
	return value;
}
function document(draft: unknown): CardDocument {
	const result = convertCards({
		operationId: "draft-compatibility",
		sourceIds: ["s1", "s2"],
		assetIds: [asset],
		cards: [{ position: 1, takeaway: "A point", role: "evidence", draft }],
	})[0];
	if (!result || !("card" in result))
		throw new Error(`Invalid draft fixture: ${JSON.stringify(result)}`);
	return assembleDocument({
		title: "Draft fixture",
		theme: "paper",
		cards: [result.card],
		assetIds: [asset],
	});
}

describe("document draft extraction parity", () => {
	it("matches all curated decks, readable versions and card order", async () => {
		for (const template of CARD_TEMPLATES) {
			const assetIds = Object.keys(template.assets);
			for (const schemaVersion of [1, 2, 3]) {
				const input = { ...template.document, schemaVersion };
				const result = await compare(JSON.stringify({ document: input, assetIds }));
				const normalized = parseCardDocument(input, { knownAssets: new Set(assetIds) });
				expect(result.cards).toEqual(
					Object.fromEntries(
						normalized.cardOrder.map((id) => [id, cardToDraft(required(normalized.cards[id]))]),
					),
				);
			}
		}
	});

	it("preserves every node mapping and existing widget round-trip assertions", async () => {
		const drafts = [
			{
				layout: "title",
				nodes: [
					{ type: "heading", text: "**Bold** and *italic*" },
					{ type: "paragraph", text: "Literal * text" },
				],
				notes: "Speaker notes",
				sourceIds: ["s1", "s1", "s2"],
			},
			{
				layout: "bullets",
				nodes: [
					{ type: "heading", text: "Bullets" },
					{ type: "bullets", items: ["**First**", "*Second*"] },
				],
			},
			{
				layout: "comparison",
				nodes: [
					{ type: "heading", text: "Compare" },
					{
						type: "columns",
						columns: [
							{ heading: "A", items: ["One", "Two"] },
							{ heading: "B", items: ["Three", "Four"] },
						],
					},
				],
			},
			{
				layout: "process",
				nodes: [
					{ type: "heading", text: "Process" },
					{
						type: "steps",
						items: [
							{ title: "A", detail: "**Detail**" },
							{ title: "B" },
							{ title: "C", detail: "*More*" },
						],
					},
				],
			},
			{
				layout: "quote",
				nodes: [{ type: "quote", text: "A **quotation**", attribution: "An author" }],
			},
			{
				layout: "stats",
				nodes: [
					{ type: "heading", text: "Stats" },
					{ type: "stat", value: "12", label: "A" },
					{ type: "stat", value: "24", label: "B" },
				],
			},
			{
				layout: "image-left",
				nodes: [
					{ type: "heading", text: "Photo" },
					{ type: "paragraph", text: "Caption" },
					{ type: "image", assetId: asset, alt: "Photo" },
				],
			},
			{
				layout: "chart",
				nodes: [
					{ type: "heading", text: "Chart" },
					{
						type: "chart",
						kind: "column",
						size: "full",
						categories: ["A", "B"],
						series: [{ name: "Count", values: [-0, 1234.5] }],
						prefix: "$",
						suffix: " GW",
						caption: "A caption",
					},
				],
			},
			{
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
			},
		];
		for (const draft of drafts) {
			const input = document(draft);
			const result = await compare(JSON.stringify({ document: input, assetIds: [asset] }));
			for (const id of input.cardOrder) {
				// Match JSON transport, including its normalization of negative zero.
				expect(result.cards[id]).toEqual(
					JSON.parse(JSON.stringify(cardToDraft(required(input.cards[id])))),
				);
			}
		}
		const widgetDocument = document(drafts[8]);
		const id = required(widgetDocument.cardOrder[0]);
		const result = await compare(JSON.stringify({ document: widgetDocument }));
		expect((result.cards[id] as { nodes: unknown[] }).nodes).toEqual([
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
	});

	it("keeps UTF-16 rich text, optional notes and image omission", async () => {
		const input = document({ layout: "title", nodes: [{ type: "heading", text: "Heading" }] });
		const card = required(input.cards[required(input.cardOrder[0])]);
		const heading = card.nodes[0];
		if (heading?.type !== "heading") throw new Error("Missing heading");
		heading.text = [
			{ text: "Both", bold: true, italic: true },
			{ text: "\ud800" },
			{ text: "\ud83d" },
			{ text: "\ude00" },
		];
		card.notes = "Notes \udfff";
		card.sourceIds = ["s1", "s1", "s2"];
		const result = await compare(JSON.stringify({ document: input }));
		expect(result.cards[card.id]).toEqual({
			takeaway: card.takeaway,
			layout: "title",
			nodes: [{ type: "heading", text: "**Both**\ud800😀" }],
			sourceIds: ["s1", "s2"],
			notes: "Notes \udfff",
		});
	});

	it("preserves validation failures and checks versions before body parsing", async () => {
		for (const body of [
			"",
			"{",
			"null",
			"[]",
			"{}",
			'{"assetIds":[null]}',
			'{"assetIds":false}',
			'{"document":{"schemaVersion":3,"cardOrder":[{"toString":null}],"cards":null}}',
			'{"document":{"\\ud800":1}}',
		])
			await compare(body);
		for (const version of [null, "1", "3, 3"]) {
			const response = await send("not JSON", version);
			expect(response.status).toBe(409);
		}
		for (const method of ["GET", "HEAD", "PUT", "DELETE"])
			expect((await send("", "3", method)).status).toBe(404);
	});
});
