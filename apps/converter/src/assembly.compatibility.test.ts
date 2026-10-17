import { describe, expect, it } from "bun:test";
import {
	assembleDocument,
	CARD_TEMPLATES,
	cleanText,
	THEMES,
	validateCardDocument,
} from "@slidesage/cards";
import { handle as referenceHandle, SCHEMA_VERSION_HEADER } from "./handler";

async function post(body: unknown, raw?: string): Promise<Response> {
	const target = process.env["CONVERTER_UNDER_TEST_URL"];
	const request = new Request("http://converter/v1/documents", {
		method: "POST",
		headers: { "Content-Type": "application/json", [SCHEMA_VERSION_HEADER]: "3" },
		body: raw ?? JSON.stringify(body),
	});
	if (!target) return referenceHandle(request);
	const url = new URL(target);
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error("CONVERTER_UNDER_TEST_URL must be an HTTP test worker");
	return fetch(new URL("/v1/documents", url), {
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

const template = CARD_TEMPLATES[0];
if (!template) throw new Error("Missing starter template");
const first = template.document.cards[template.document.cardOrder[0] ?? ""];
if (!first) throw new Error("Missing starter card");
const valid = {
	title: "Grid storage",
	theme: "paper",
	cards: [first],
	assetIds: Object.keys(template.assets),
};

async function matchesReference(body: unknown, raw?: string) {
	const expected = await referenceHandle(
		new Request("http://converter/v1/documents", {
			method: "POST",
			headers: { [SCHEMA_VERSION_HEADER]: "3" },
			body: raw ?? JSON.stringify(body),
		}),
	);
	const actual = await post(body, raw);
	expect(actual.status).toBe(expected.status);
	expect(actual.headers.get("content-type")).toBe(expected.headers.get("content-type"));
	expect(await actual.json()).toEqual(await expected.json());
}

describe("native assembly compatibility", () => {
	it("reuses assembly assertions for valid documents and all curated themes", async () => {
		for (const starter of CARD_TEMPLATES) {
			for (const theme of THEMES) {
				const input = {
					title: starter.name,
					theme,
					cards: starter.document.cardOrder.map((id) => starter.document.cards[id]),
					assetIds: Object.keys(starter.assets),
				};
				const response = await post(input);
				expect(response.status).toBe(200);
				const { document } = (await response.json()) as {
					document: ReturnType<typeof assembleDocument>;
				};
				expect(document).toEqual(assembleDocument(input as Parameters<typeof assembleDocument>[0]));
				expect(document.cardOrder).toHaveLength(5);
				expect(validateCardDocument(document, { knownAssets: new Set(input.assetIds) })).toEqual({
					ok: true,
					value: document,
				});
			}
		}
	});

	it("preserves request checks, malformed cards, coercion and duplicate ID priorities", async () => {
		for (const body of [
			{},
			{ title: null, theme: "invalid", cards: null },
			{ theme: "paper" },
			{ ...valid, title: "\uFEFF" },
			{ ...valid, title: 4 },
			{ ...valid, cards: null },
			{ ...valid, cards: [], assetIds: false },
			{ ...valid, cards: [null], assetIds: [null] },
			{ ...valid, assetIds: ["\u2000"] },
			{ ...valid, assetIds: null },
			{ ...valid, cards: [] },
			{ ...valid, cards: [null] },
			{ ...valid, cards: [false] },
			{ ...valid, cards: [4] },
			{ ...valid, cards: ["text"] },
			{ ...valid, cards: [[]] },
			{ ...valid, cards: [{}] },
			{ ...valid, cards: [{ ...first, extra: 1 }] },
			{ ...valid, cards: [first, first] },
			{ ...valid, cards: [{ id: first.id, extra: 1 }, first] },
			{ ...valid, cards: [first, { id: first.id, extra: 1 }] },
			{ ...valid, title: "<script></script>" },
			{ ...valid, title: "x".repeat(121) },
			{ ...valid, title: "😀".repeat(120) },
			{ ...valid, title: "😀".repeat(121) },
		])
			await matchesReference(body);
		for (const id of [
			null,
			true,
			0,
			-0,
			1.5,
			"0",
			"__proto__",
			"constructor",
			[],
			[null],
			["c_first001"],
			{},
			{ toString: null },
			{ toString: "x", valueOf: 3 },
		]) {
			await matchesReference({ ...valid, cards: [{ ...first, id }] });
		}
		await matchesReference(null, '{"theme":"paper","title":"T","cards":[{"id":1e400}]}');
		await matchesReference(
			null,
			'{"theme":"paper","title":"T","cards":[{"id":"old","id":"c_first001"}]}',
		);
	});

	it("matches cleanText HTML attributes, control ranges, JavaScript spaces and NFC", async () => {
		const titles = [
			"  <SPAN title='x>y'>Cafe\u0301</SPAN>\u0085\u2069 end  ",
			"a<b and c>d",
			"<custom>text</custom>",
			"<b disabled>text</b>",
			'<b data-x = "v">text</b>',
			"<b a:b='x' _x = z>text</b>",
			"<b x='unterminated>text",
			"<b x=no/>text",
			"<b / >text</b>",
			"<h7>text</h7>",
			"<H6>text</H6>",
			"<img src='x'/>Title",
			"<script>alert(1)</script>",
			"a\u0000\u001f\u007f\u009f\u200b\u200f\u202a\u202e\u2060\u2069\ufeffb",
			"a\u0020\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000b",
			"a\u180e\u200a\u206a\u202f\u0085b",
			"\ud800e\u0301\udc00",
			"가가 e\u0301",
		];
		const tags = [
			"a",
			"b",
			"big",
			"blockquote",
			"br",
			"code",
			"del",
			"div",
			"em",
			"embed",
			"font",
			"h1",
			"h6",
			"hr",
			"i",
			"iframe",
			"img",
			"ins",
			"li",
			"mark",
			"object",
			"ol",
			"p",
			"pre",
			"s",
			"script",
			"small",
			"span",
			"strike",
			"strong",
			"style",
			"sub",
			"sup",
			"svg",
			"table",
			"tbody",
			"td",
			"th",
			"thead",
			"tr",
			"u",
			"ul",
		];
		for (const tag of tags) titles.push(`<${tag} x="v">T</${tag}>`);
		for (const title of titles) {
			const response = await post({ ...valid, title });
			expect(response.status).toBe(200);
			const result = (await response.json()) as { document: { title: string } };
			expect(result.document.title).toBe(cleanText(title));
		}
	});
});
