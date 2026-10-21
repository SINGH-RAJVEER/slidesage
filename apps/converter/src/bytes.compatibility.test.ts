import { describe, expect, it } from "bun:test";
import { assembleDocument, CARD_TEMPLATES, convertCards, THEMES } from "@slidesage/cards";
import { ASSET, deckDrafts, mutate, OTHER_ASSET, random } from "./compatibility.fixtures";
import { handle as referenceHandle, SCHEMA_VERSION_HEADER } from "./handler";

// Byte-level differential checks: every request goes to this converter and to
// the one under test, and the two answers must match in status, content type,
// and every byte of the body, so key order and number formatting count too.
const target = process.env["CONVERTER_UNDER_TEST_URL"];

async function expectSame(path: string, body: string) {
	const init = { method: "POST", headers: { [SCHEMA_VERSION_HEADER]: "3" }, body };
	const expected = await referenceHandle(new Request(`http://converter${path}`, init));
	const actual = await fetch(new URL(path, target), init);
	const label = `${path} ${body.length > 600 ? `${body.slice(0, 600)}...` : body}`;
	expect(actual.status, label).toBe(expected.status);
	expect(actual.headers.get("content-type"), label).toBe(expected.headers.get("content-type"));
	expect(await actual.text(), label).toBe(await expected.text());
}

const drafts = deckDrafts();
const sourceIds = ["s1", "s2"];
const converted = convertCards({
	operationId: "op-1",
	sourceIds,
	assetIds: [ASSET],
	cards: drafts,
});
const cards = converted.flatMap((result) => ("card" in result ? [result.card] : []));
const deck = assembleDocument({ title: "Grid storage", theme: "ocean", cards, assetIds: [ASSET] });
const documents = [
	{ document: deck, assetIds: [ASSET] },
	...CARD_TEMPLATES.map((template) => ({
		document: template.document,
		assetIds: Object.keys(template.assets),
	})),
];

describe.skipIf(!target)("byte-identical converter answers", () => {
	it("converts every drafted layout and widget", async () => {
		expect(cards.length).toBeGreaterThan(18);
		await expectSame(
			"/v1/cards",
			JSON.stringify({ operationId: "op-1", sourceIds, assetIds: [ASSET], cards: drafts }),
		);
		for (const position of [1, 2.0, 1e21, 1e300, 2 ** 53 + 2]) {
			await expectSame(
				"/v1/cards",
				JSON.stringify({
					operationId: "op\ud800é-\u{1f680}",
					cards: [{ ...drafts[0], position }],
				}),
			);
		}
	}, 300_000);

	it("converts mutated drafts the same way", async () => {
		const next = random(1);
		const request = {
			operationId: "op-1",
			sourceIds,
			assetIds: [ASSET, OTHER_ASSET],
			cards: drafts,
		};
		for (let index = 0; index < 2500; index++) {
			let body = mutate(request, next);
			if (next() < 0.3) body = mutate(body, next);
			await expectSame("/v1/cards", JSON.stringify(body));
		}
	}, 300_000);

	it("assembles, validates, and drafts documents the same way", async () => {
		await expectSame(
			"/v1/documents",
			JSON.stringify({ title: "Deck", theme: "paper", cards, assetIds: [ASSET] }),
		);
		for (const theme of THEMES) {
			await expectSame("/v1/documents", JSON.stringify({ title: " <b>A</b>​ deck ", theme, cards }));
		}
		for (const body of documents) {
			await expectSame("/v1/documents/validate", JSON.stringify(body));
			await expectSame("/v1/documents/drafts", JSON.stringify(body));
		}
		const next = random(2);
		for (let index = 0; index < 1500; index++) {
			await expectSame(
				"/v1/documents",
				JSON.stringify(mutate({ title: "Deck", theme: "grove", cards, assetIds: [ASSET] }, next)),
			);
		}
		for (let index = 0; index < 3000; index++) {
			const body = mutate(documents[index % documents.length], next);
			await expectSame(
				index % 2 ? "/v1/documents/validate" : "/v1/documents/drafts",
				JSON.stringify(body),
			);
		}
	}, 300_000);

	it("answers malformed bodies the same way", async () => {
		for (const body of [
			"",
			"[]",
			"{",
			'{"cards":null}',
			'{"operationId":"x","cards":[null]}',
			'{"operationId":"x","cards":[[]]}',
			'{"operationId":"x","cards":[{"position":1,"role":"opening","takeaway":"t","draft":{"layout":"title","nodes":[{"type":"heading","text":"a"}]}}],"sourceIds":[1]}',
			'{"title":"t","theme":"paper","cards":[null]}',
			'{"title":"t","theme":"paper","cards":[{"id":{"toString":1}}]}',
			'{"title":"t","theme":"paper","cards":[{"id":"toString"}]}',
			'{"title":"t","theme":"paper","cards":[5,"x",true]}',
			'{"document":{"schemaVersion":3,"cardOrder":[{"toString":1}],"cards":{}}}',
			'{"document":{"schemaVersion":3,"cardOrder":["constructor"],"cards":{}}}',
			'{"document":{"schemaVersion":3,"cardOrder":[[1,[2]]],"cards":{"1,2":{}}}}',
			'{"document":null,"assetIds":[" "]}',
		]) {
			for (const path of [
				"/v1/cards",
				"/v1/documents",
				"/v1/documents/validate",
				"/v1/documents/drafts",
			]) {
				await expectSame(path, body);
			}
		}
	}, 300_000);
});
