import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { assembleDocument, cleanText, convertCards, parseInlineMarkup } from "./convert";
import { cardToDraft } from "./draft-format";
import { type Card, THEMES } from "./schema";
import {
	CARD_TEMPLATES,
	createTemplateDeck,
	SAMPLE_ASSETS,
	TEMPLATE_CATEGORIES,
} from "./templates";
import { CARD_THEME_DEFINITIONS, CURATED_THEMES, SERIES_SLOTS } from "./themes";
import { validateCardDocument } from "./validate";

describe("curated starter decks", () => {
	it("provides complete, valid decks with resolvable images and category metadata", () => {
		expect(CARD_TEMPLATES).toHaveLength(6);
		expect(new Set(CARD_TEMPLATES.map((template) => template.id)).size).toBe(6);
		expect(CURATED_THEMES).toHaveLength(6);
		for (const template of CARD_TEMPLATES) {
			expect(TEMPLATE_CATEGORIES.some((category) => category.id === template.category)).toBe(true);
			expect(template.document.cardOrder).toHaveLength(5);
			expect(template.document.cards[template.previewCardId]).toBeDefined();
			expect(
				validateCardDocument(template.document, {
					knownAssets: new Set(Object.keys(template.assets)),
				}).ok,
			).toBe(true);
			const cards = template.document.cardOrder.map((id) => template.document.cards[id]);
			expect(cards[0]?.role).toBe("opening");
			expect(cards.at(-1)?.role).toBe("closing");
			expect(new Set(cards.map((card) => card?.layout)).size).toBeGreaterThanOrEqual(4);
			for (const card of cards) {
				for (const node of card?.nodes ?? []) {
					if (node.type === "image")
						expect(template.assets[node.assetId]?.url).toStartWith("https://images.unsplash.com/");
				}
			}
		}
	});

	it("keeps remote asset IDs consistent with the API's provider identity digest", () => {
		for (const [id, asset] of Object.entries(SAMPLE_ASSETS)) {
			expect(id).toBe(
				createHash("sha256")
					.update(`${asset.source.provider}:${asset.source.providerId}`)
					.digest("hex"),
			);
			expect(asset.byteSize).toBe(0);
		}
	});

	it("returns independent editable copies", () => {
		const first = createTemplateDeck("ocean-proposal");
		const second = createTemplateDeck("ocean-proposal");
		first.document.title = "My proposal";
		const asset = Object.values(first.assets)[0];
		if (asset) asset.source.photographer = "Changed";
		expect(second).toEqual(createTemplateDeck("ocean-proposal"));
		expect(first).not.toEqual(second);
		expect(() => createTemplateDeck("missing")).toThrow(RangeError);
	});

	it("accepts all registered theme IDs, including existing documents", () => {
		const document = createTemplateDeck("mono-briefing").document;
		for (const theme of THEMES) {
			expect(validateCardDocument({ ...document, theme }).ok).toBe(true);
			expect(CARD_THEME_DEFINITIONS[theme].id).toBe(theme);
		}
		expect(THEMES).toEqual(expect.arrayContaining(["slate", "paper", "ember"]));
		expect(validateCardDocument({ ...document, theme: "unknown" }).ok).toBe(false);
	});

	it("gives every theme a full chart palette with legible tone colors", () => {
		const luminance = (hex: string) => {
			const [r = 0, g = 0, b = 0] = [1, 3, 5].map((offset) => {
				const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
				return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const contrast = (first: string, second: string) => {
			const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
			return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
		};
		for (const theme of Object.values(CARD_THEME_DEFINITIONS)) {
			expect(theme.chart.series).toHaveLength(SERIES_SLOTS);
			expect(new Set(theme.chart.series).size).toBe(SERIES_SLOTS);
			expect(contrast(theme.chart.positive, theme.palette.surface)).toBeGreaterThanOrEqual(3);
			if (theme.appearance === "light") continue;
			// Dark surfaces keep every series near 3:1 or above; light ones rely on value labels.
			for (const color of theme.chart.series) {
				expect(contrast(color, theme.palette.surface)).toBeGreaterThanOrEqual(2.8);
			}
		}
	});
});

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
		const image = convertOne({ layout: "title", nodes: [{ type: "video", src: "x" }] });
		expect("issue" in image && image.issue.path).toBe("card.nodes[0].type");
		const source = convertOne({ ...bulletsDraft, sourceIds: ["s9"] });
		expect("issue" in source && source.issue.message).toBe("names unknown source s9");
	});
});

describe("text cleaning", () => {
	it("strips tags, control characters, and bidirectional overrides", () => {
		expect(cleanText("  <b>Hi</b>‮ there\n\tfriend ")).toBe("Hi there friend");
		expect(cleanText('<SPAN class="note">Hi</SPAN><br/>there')).toBe("Hithere");
		expect(cleanText("<svg onload=alert(1)>Hi</svg>")).toBe("Hi");
	});

	it("keeps comparisons that look like tags", () => {
		expect(cleanText("If a<b and c>d then a<d")).toBe("If a<b and c>d then a<d");
		expect(cleanText("x<y, p<q but q>r")).toBe("x<y, p<q but q>r");
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

const asset = "a".repeat(64);

describe("images", () => {
	const imageDraft = {
		layout: "image-left",
		nodes: [
			{ type: "image", assetId: asset, alt: "Battery racks in a warehouse" },
			{ type: "heading", text: "Storage at scale" },
			{ type: "paragraph", text: "Warehouses of batteries now back up city grids." },
		],
	};

	it("accepts an image the operation stored", () => {
		const [result] = convertCards({
			operationId: "op-1",
			sourceIds: [],
			assetIds: [asset],
			cards: [{ position: 1, takeaway: "Scale", role: "evidence", draft: imageDraft }],
		});
		expect(result && "card" in result && result.card.nodes[0]).toMatchObject({
			type: "image",
			assetId: asset,
			fit: "cover",
		});
	});

	it("refuses an image the operation did not store", () => {
		const [result] = convertCards({
			operationId: "op-1",
			sourceIds: [],
			cards: [{ position: 1, takeaway: "Scale", role: "evidence", draft: imageDraft }],
		});
		expect(result && "issue" in result && result.issue.path).toBe("card.nodes[0].assetId");
	});

	it("requires text beside the image", () => {
		const [result] = convertCards({
			operationId: "op-1",
			sourceIds: [],
			assetIds: [asset],
			cards: [
				{
					position: 1,
					takeaway: "Scale",
					role: "evidence",
					draft: { ...imageDraft, nodes: imageDraft.nodes.slice(0, 2) },
				},
			],
		});
		expect(result && "issue" in result && result.issue.message).toContain(
			"needs a paragraph or bullets node",
		);
	});
});

describe("schema versions", () => {
	it("reads a stored version 1 document as version 2", () => {
		const document = assembleDocument({
			title: "Grid storage",
			theme: "slate",
			cards: [card(bulletsDraft)],
		});
		const stored = { ...document, schemaVersion: 1 };
		const result = validateCardDocument(stored);
		expect(result.ok && result.value.schemaVersion).toBe(2);
	});

	it("refuses versions this build cannot read", () => {
		const document = assembleDocument({
			title: "Grid storage",
			theme: "slate",
			cards: [card(bulletsDraft)],
		});
		expect(validateCardDocument({ ...document, schemaVersion: 3 }).ok).toBe(false);
	});
});

describe("cardToDraft", () => {
	it("writes a converted card back as the draft it came from", () => {
		const converted = card({
			...bulletsDraft,
			notes: "Mention the pilot",
		});
		const draft: unknown = cardToDraft(converted);
		expect(draft).toEqual({
			takeaway: "Storage lowers peak costs",
			...bulletsDraft,
			notes: "Mention the pilot",
		});
	});

	it("covers every text node and leaves photos out", () => {
		const converted = card({
			layout: "process",
			nodes: [
				{ type: "heading", text: "How it works" },
				{
					type: "steps",
					items: [
						{ title: "Charge", detail: "At *night*" },
						{ title: "Hold" },
						{ title: "Discharge" },
					],
				},
			],
		});
		const draft = cardToDraft(converted);
		expect(draft.nodes).toEqual([
			{ type: "heading", text: "How it works" },
			{
				type: "steps",
				items: [
					{ title: "Charge", detail: "At *night*" },
					{ title: "Hold" },
					{ title: "Discharge" },
				],
			},
		]);
		const withPhoto: Card = {
			...converted,
			nodes: [
				{ id: "n_photo", type: "image", assetId: "a".repeat(64), alt: "Batteries", fit: "cover" },
				...converted.nodes,
			],
		};
		expect(cardToDraft(withPhoto).nodes).toEqual(draft.nodes);
	});
});
