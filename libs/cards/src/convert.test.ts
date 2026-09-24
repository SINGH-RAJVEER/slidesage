import { describe, expect, it } from "bun:test";
import { assembleDocument, cleanText, convertCards, parseInlineMarkup } from "./convert";
import type { Card } from "./schema";
import { validateCardDocument } from "./validate";

const bulletsDraft = {
	layout: "bullets",
	nodes: [
		{ type: "heading", text: "Storage cuts **peak** costs" },
		{ type: "bullets", items: ["Shifts load to *off-peak* hours", "Defers grid upgrades"] },
	],
	sourceIds: ["s1"],
};

function convertOne(draft: unknown, position = 1, operationId = "op-1") {
	const [result] = convertCards({
		operationId,
		sourceIds: ["s1", "s2"],
		cards: [{ position, takeaway: "Storage lowers peak costs", role: "evidence", draft }],
	});
	if (!result) throw new Error("no result");
	return result;
}

function card(draft: unknown, position = 1): Card {
	const result = convertOne(draft, position);
	if (!("card" in result)) throw new Error(result.issue.message);
	return result.card;
}

describe("convertCards", () => {
	it("converts a draft into a card with emphasis runs", () => {
		const converted = card(bulletsDraft);
		expect(converted.layout).toBe("bullets");
		expect(converted.nodes[0]).toMatchObject({
			type: "heading",
			text: [{ text: "Storage cuts " }, { text: "peak", bold: true }, { text: " costs" }],
		});
		expect(converted.sourceIds).toEqual(["s1"]);
	});

	it("derives the same IDs when the same operation converts again", () => {
		expect(card(bulletsDraft)).toEqual(card(bulletsDraft));
		expect(card(bulletsDraft, 2).id).not.toBe(card(bulletsDraft, 1).id);
	});

	it("reports a layout that does not fit the content", () => {
		const result = convertOne({
			layout: "bullets",
			nodes: [
				{ type: "heading", text: "One point" },
				{ type: "bullets", items: ["Only one"] },
			],
		});
		expect("issue" in result && result.issue.message).toContain("needs 2-6 bullets items, got 1");
	});

	it("reports text over its limit with the measured length", () => {
		const result = convertOne({
			layout: "statement",
			nodes: [
				{ type: "heading", text: "x".repeat(91) },
				{ type: "paragraph", text: "Fine" },
			],
		});
		expect("issue" in result && result.issue).toEqual({
			path: "card.nodes[0].text",
			message: "is 91 characters, the limit is 90",
		});
	});

	it("refuses unknown node types and unknown sources", () => {
		const image = convertOne({ layout: "title", nodes: [{ type: "image", src: "x" }] });
		expect("issue" in image && image.issue.path).toBe("card.nodes[0].type");
		const source = convertOne({ ...bulletsDraft, sourceIds: ["s9"] });
		expect("issue" in source && source.issue.message).toBe("names unknown source s9");
	});
});

describe("text cleaning", () => {
	it("strips tags, control characters, and bidirectional overrides", () => {
		expect(cleanText("  <b>Hi</b>‮ there\n\tfriend ")).toBe("Hi there friend");
	});

	it("leaves unpaired asterisks literal", () => {
		expect(parseInlineMarkup("5 * 3 = 15")).toEqual([{ text: "5 * 3 = 15" }]);
	});
});

describe("assembleDocument", () => {
	it("produces a document that validates", () => {
		const document = assembleDocument({
			title: "Grid storage",
			theme: "slate",
			cards: [card(bulletsDraft, 1), card(bulletsDraft, 2)],
		});
		expect(document.cardOrder).toHaveLength(2);
		expect(validateCardDocument(document)).toEqual({ ok: true, value: document });
	});

	it("rejects fields the schema does not know", () => {
		const document = assembleDocument({ title: "T", theme: "paper", cards: [card(bulletsDraft)] });
		const tampered = { ...document, style: "color:red" };
		const result = validateCardDocument(tampered);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.issue.path).toBe("document.style");
	});
});
