import { describe, expect, it } from "bun:test";
import { assembleDocument, CARD_TEMPLATES, convertCards, THEMES } from "@slidesage/cards";
import JSZip from "jszip";
import { ASSET, deckDrafts, mutate, PIXEL, random } from "./compatibility.fixtures";
import { handle as referenceHandle, SCHEMA_VERSION_HEADER } from "./handler";

// PPTX differential checks: the same export goes to this converter and to the
// one under test, and every part of both files must match byte for byte. Two
// things are normalized. Timestamps differ by nature. pptxgenjs numbers
// charts with a counter shared by every export in the process, so a running
// converter's chart numbers keep climbing, while a fresh one starts at one.
const target = process.env["CONVERTER_UNDER_TEST_URL"];

function normalize(text: string, numbers: Map<string, string>) {
	return text
		.replace(/(dcterms:(?:created|modified) xsi:type="dcterms:W3CDTF">)[^<]*/g, "$1TIME")
		.replace(
			/(chart|Microsoft_Excel_Worksheet)(\d+)\.(xml|xlsx)/g,
			(_, prefix, number, extension) => {
				if (!numbers.has(number)) numbers.set(number, String(numbers.size + 1));
				return `${prefix}${numbers.get(number)}.${extension}`;
			},
		);
}

/** Every entry of a zip, nested workbooks expanded, with chart numbers in order of use. */
async function parts(
	data: ArrayBuffer | Uint8Array,
	prefix = "",
	numbers = new Map<string, string>(),
) {
	const zip = await JSZip.loadAsync(data);
	const result: [string, string][] = [];
	const types = zip.file("[Content_Types].xml");
	if (types) normalize(await types.async("string"), numbers);
	for (const entry of Object.values(zip.files)) {
		const name = normalize(entry.name, numbers);
		if (entry.dir) {
			result.push([`${prefix}${name}`, "<dir>"]);
		} else if (entry.name.endsWith(".xlsx")) {
			result.push([`${prefix}${name}`, "<workbook>"]);
			result.push(...(await parts(await entry.async("uint8array"), `${prefix}${name}!`, numbers)));
		} else if (/\.(png|jpe?g)$/.test(entry.name)) {
			result.push([
				`${prefix}${name}`,
				Buffer.from(await entry.async("uint8array")).toString("base64"),
			]);
		} else {
			result.push([`${prefix}${name}`, normalize(await entry.async("string"), numbers)]);
		}
	}
	return result;
}

async function expectSameExport(body: unknown, label: string) {
	const init = {
		method: "POST",
		headers: { [SCHEMA_VERSION_HEADER]: "3" },
		body: JSON.stringify(body),
	};
	const expected = await referenceHandle(new Request("http://converter/v1/documents/pptx", init));
	const actual = await fetch(new URL("/v1/documents/pptx", target), init);
	expect(actual.status, label).toBe(expected.status);
	expect(actual.headers.get("content-type"), label).toBe(expected.headers.get("content-type"));
	if (expected.status !== 200) {
		expect(await actual.text(), label).toBe(await expected.text());
		return;
	}
	const [want, got] = await Promise.all([
		parts(await expected.arrayBuffer()),
		parts(await actual.arrayBuffer()),
	]);
	expect(want.length, label).toBeGreaterThan(40);
	expect(
		got.map(([name]) => name),
		label,
	).toEqual(want.map(([name]) => name));
	for (const [index, [name, content]] of want.entries()) {
		expect(got[index]?.[1], `${label} ${name}`).toBe(content);
	}
}

const drafts = deckDrafts();
const converted = convertCards({
	operationId: "op-1",
	sourceIds: ["s1", "s2"],
	assetIds: [ASSET],
	cards: drafts,
});
const cards = converted.flatMap((result) => ("card" in result ? [result.card] : []));
const deck = assembleDocument({
	title: "Grid & <storage>",
	theme: "ocean",
	cards,
	assetIds: [ASSET],
});

const credit = {
	type: "stock",
	provider: "unsplash",
	photographer: "Ada",
	photographerUrl: "https://unsplash.com/@ada?utm_source=slidesage&utm_medium=referral",
};
const assets = (source: unknown = credit, mimeType = "image/png", width = 1600, height = 900) => ({
	[ASSET]: { mimeType, width, height, data: PIXEL, source },
});
const sources = [
	{ url: "https://example.com/report?a=1&b=2", title: "Report <1>" },
	{ title: "Offline" },
];

describe.skipIf(!target)("byte-identical PPTX exports", () => {
	it("writes every layout and widget in every theme", async () => {
		for (const theme of THEMES) {
			await expectSameExport({ document: { ...deck, theme }, assets: assets(), sources }, theme);
		}
	}, 300_000);

	it("writes the curated templates", async () => {
		for (const template of CARD_TEMPLATES) {
			const templateAssets = Object.fromEntries(
				Object.entries(template.assets).map(([id, asset]) => [
					id,
					{
						mimeType: "image/jpeg",
						width: asset.width,
						height: asset.height,
						data: PIXEL,
						source: asset.source,
					},
				]),
			);
			await expectSameExport({ document: template.document, assets: templateAssets }, template.id);
		}
	}, 300_000);

	it("writes image shapes, credits, and sources the same way", async () => {
		const variants: [string, unknown][] = [
			["no source", undefined],
			["pexels", { ...credit, provider: "pexels" }],
			["unknown provider", { ...credit, provider: "flickr" }],
			["prototype provider", { ...credit, provider: "constructor" }],
			["proto provider", { ...credit, provider: "__proto__" }],
			["numeric photographer", { ...credit, photographer: 42, photographerUrl: 7 }],
			[
				"array photographer",
				{ ...credit, photographer: ["A", ["B", null]], provider: ["unsplash"] },
			],
			["no photographer url", { type: "stock", photographer: "Ada" }],
			["not stock", { ...credit, type: "upload" }],
			["boolean photographer", { ...credit, photographer: true }],
			["empty array url", { ...credit, photographerUrl: [] }],
			["array source", [credit]],
		];
		for (const [label, source] of variants) {
			await expectSameExport({ document: deck, assets: assets(source), sources }, label);
		}
		for (const [width, height] of [
			[1, 1],
			[400, 3000],
			[5000, 10],
			[1e300, 1],
			[1.5, 2.25],
		]) {
			await expectSameExport(
				{ document: deck, assets: assets(credit, "image/jpeg", width, height) },
				`${width}x${height}`,
			);
		}
		for (const list of [
			[],
			[{}],
			[{ url: "ftp://x" }],
			[{ url: "HTTPS://A.EXAMPLE", title: "" }],
			null,
			[1, "x"],
		]) {
			await expectSameExport(
				{ document: deck, assets: assets(), sources: list },
				JSON.stringify(list),
			);
		}
	}, 300_000);

	it("splits line breaks in text, cells, and notes the same way", async () => {
		const broken = JSON.parse(
			JSON.stringify(deck, (key, value) =>
				typeof value === "string" && ["text", "title", "notes", "label", "heading"].includes(key)
					? `${value.slice(0, 20)}\nnext\r\nline\n`.replace(/^(.)/, "$1\n")
					: Array.isArray(value) && key === "cells"
						? value.map((cell: string) => (cell ? `${cell}\nmore` : cell))
						: value,
			),
		);
		const response = await referenceHandle(
			new Request("http://converter/v1/documents/pptx", {
				method: "POST",
				headers: { [SCHEMA_VERSION_HEADER]: "3" },
				body: JSON.stringify({ document: broken, assets: assets(), sources }),
			}),
		);
		expect(response.status).toBe(200);
		await expectSameExport({ document: broken, assets: assets(), sources }, "line breaks");
	}, 300_000);

	it("writes mutated documents the same way", async () => {
		const next = random(3);
		for (let index = 0; index < 1500; index++) {
			const document = mutate(deck, next);
			await expectSameExport({ document, assets: assets(), sources }, `mutation ${index}`);
		}
	}, 600_000);
});
