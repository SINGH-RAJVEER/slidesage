import { describe, expect, it } from "bun:test";
import {
	assembleDocument,
	CARD_TEMPLATES,
	CARD_THEME_DEFINITIONS,
	type CardDraftInput,
	convertCards,
	THEMES,
} from "@slidesage/cards";
import JSZip from "jszip";
import { handle, SCHEMA_VERSION_HEADER } from "./handler";
import { wrappedLines } from "./pptx";

const ASSET = "a".repeat(64);
// A 1x1 PNG.
const PIXEL =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const EMU_PER_INCH = 914400;

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

function deck(): unknown {
	const drafts = [
		card(1, "title", [
			{ type: "heading", text: "Grid storage" },
			{ type: "paragraph", text: "Why **batteries** matter" },
		]),
		card(2, "statement", [
			{ type: "heading", text: "Storage is the bottleneck" },
			{ type: "paragraph", text: "Renewables need somewhere to put the surplus." },
		]),
		card(
			3,
			"bullets",
			[
				{ type: "heading", text: "Costs fell" },
				{ type: "bullets", items: ["Cells got cheaper", "Factories scaled"] },
			],
			{ sourceIds: ["s1"], notes: "Mention the 2023 report." },
		),
		card(4, "comparison", [
			{ type: "heading", text: "Lithium or iron" },
			{
				type: "columns",
				columns: [
					{ heading: "Lithium", items: ["Dense", "Costly"] },
					{ heading: "Iron", items: ["Heavy", "Cheap"] },
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
					{ title: "Build" },
				],
			},
		]),
		card(6, "quote", [
			{ type: "quote", text: "Storage is the new baseload.", attribution: "An engineer" },
		]),
		card(7, "stats", [
			{ type: "heading", text: "By the numbers" },
			{ type: "stat", value: "90%", label: "Cost drop since 2010" },
			{ type: "stat", value: "4h", label: "Typical duration" },
		]),
		card(8, "image-left", [
			image,
			{ type: "heading", text: "Warehouses of cells" },
			{ type: "paragraph", text: "They back up whole grids." },
		]),
		card(9, "cover", [image, { type: "heading", text: "What comes next" }]),
		card(10, "bullets", [
			{ type: "heading", text: "Everything at once" },
			{ type: "bullets", items: Array.from({ length: 6 }, () => longItem) },
			{ type: "paragraph", text: longItem.repeat(2).slice(0, 400) },
		]),
	];
	const results = convertCards({
		operationId: "op-1",
		sourceIds: ["s1"],
		assetIds: [ASSET],
		cards: drafts,
	});
	const cards = results.map((result) => {
		if ("issue" in result)
			throw new Error(`card ${result.position}: ${JSON.stringify(result.issue)}`);
		return result.card;
	});
	return assembleDocument({ title: "Grid storage", theme: "paper", cards, assetIds: [ASSET] });
}

function exportDeck(body: Record<string, unknown>) {
	return handle(
		new Request("http://converter/v1/documents/pptx", {
			method: "POST",
			headers: { "Content-Type": "application/json", [SCHEMA_VERSION_HEADER]: "3" },
			body: JSON.stringify(body),
		}),
	);
}

const assets = {
	[ASSET]: {
		mimeType: "image/png",
		width: 1600,
		height: 900,
		data: PIXEL,
		source: {
			type: "stock",
			provider: "unsplash",
			photographer: "Ada",
			photographerUrl: "https://unsplash.com/@ada?utm_source=slidesage&utm_medium=referral",
		},
	},
};
const sources = [{ url: "https://example.com/report", title: "Report" }];

async function slides(response: Response) {
	const zip = await JSZip.loadAsync(await response.arrayBuffer());
	const read = (name: string) => zip.file(name)?.async("string") ?? Promise.resolve("");
	const count = Object.keys(zip.files).filter((name) =>
		/^ppt\/slides\/slide\d+\.xml$/.test(name),
	).length;
	const all = await Promise.all(
		Array.from({ length: count }, (_, index) => read(`ppt/slides/slide${index + 1}.xml`)),
	);
	return { all, read };
}

describe("PPTX export", () => {
	it("uses shared colors and native heading/body fonts for every theme", async () => {
		const template = CARD_TEMPLATES.find((template) => template.id === "mono-briefing");
		if (!template) throw new Error("Missing briefing template");
		const sampleAssets = Object.fromEntries(
			Object.entries(template.assets).map(([id, asset]) => [id, { ...asset, data: PIXEL }]),
		);
		for (const theme of THEMES) {
			const definition = CARD_THEME_DEFINITIONS[theme];
			const response = await exportDeck({
				document: { ...template.document, theme },
				assets: sampleAssets,
				sources: [],
			});
			expect(response.status).toBe(200);
			const { all, read } = await slides(response);
			expect(all).toHaveLength(5);
			for (const color of [
				definition.palette.surface,
				definition.palette.heading,
				definition.palette.body,
			]) {
				expect(all[0]).toContain(color.slice(1).toUpperCase());
			}
			expect(all[0]).toContain(`typeface="${definition.fonts.heading.face}"`);
			expect(all[0]).toContain(`typeface="${definition.fonts.body.face}"`);
			expect(all[2]).toContain(definition.palette.rule.slice(1).toUpperCase());
			expect(all[2]).toContain(definition.palette.accent.slice(1).toUpperCase());
			expect(await read("ppt/theme/theme1.xml")).toContain(definition.fonts.heading.face);
		}
	});

	it("exports every starter deck with its image nodes and photo credits", async () => {
		for (const template of CARD_TEMPLATES) {
			const sampleAssets = Object.fromEntries(
				Object.entries(template.assets).map(([id, asset]) => [id, { ...asset, data: PIXEL }]),
			);
			const response = await exportDeck({
				document: template.document,
				assets: sampleAssets,
				sources: [],
			});
			expect(response.status).toBe(200);
			const { all } = await slides(response);
			expect(all).toHaveLength(template.document.cardOrder.length);
			expect(all.join("")).toContain("<p:pic>");
			expect(all.join("")).toContain("Photo by ");
		}
	});
	it("writes every card as a slide of native text, lists, and pictures", async () => {
		const response = await exportDeck({ document: deck(), assets, sources });
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		);
		const { all, read } = await slides(response);
		expect(all).toHaveLength(10);
		expect(all[0]).toContain("Grid storage");
		expect(all[0]).toContain('b="1"');
		// Bullets are real list paragraphs, not drawn dots.
		expect(all[2]).toContain("<a:buChar");
		expect(all[2]).toContain("Cells got cheaper");
		// The citation links to its source, and the photo credit is kept.
		expect(await read("ppt/slides/_rels/slide3.xml.rels")).toContain("https://example.com/report");
		expect(all[7]).toContain("<p:pic>");
		// The photo credit links the photographer and the library.
		expect(all[7]).toContain("Photo by </a:t>");
		expect(all[7]).toContain(">Unsplash</a:t>");
		const creditLinks = await read("ppt/slides/_rels/slide8.xml.rels");
		expect(creditLinks).toContain(
			"https://unsplash.com/@ada?utm_source=slidesage&amp;utm_medium=referral",
		);
		expect(creditLinks).toContain(
			"https://unsplash.com/?utm_source=slidesage&amp;utm_medium=referral",
		);
		expect(all[5]).toContain("Storage is the new baseload.");
		expect(all[6]).toContain("90%");
		// A cover card has its photo and the scrim over it.
		expect(all[8]?.match(/<p:pic>/g)).toHaveLength(2);
		const notes = await Promise.all(
			[1, 2, 3, 4].map((index) => read(`ppt/notesSlides/notesSlide${index}.xml`)),
		);
		expect(notes.join("")).toContain("Mention the 2023 report.");
	});

	it("shrinks text that would overflow the slide and keeps every box on it", async () => {
		const response = await exportDeck({ document: deck(), assets, sources });
		const { all } = await slides(response);
		const crowded = all[9] ?? "";
		const sizes = [...crowded.matchAll(/sz="(\d+)"/g)].map((match) => Number(match[1]));
		// The heading is designed at 32.6pt; a crowded card shrinks it.
		expect(Math.max(...sizes)).toBeLessThan(3260);
		for (const slide of all) {
			for (const [, y, height] of slide.matchAll(
				/<a:off x="\d+" y="(\d+)"\/>\s*<a:ext cx="\d+" cy="(\d+)"\/>/g,
			)) {
				expect(Number(y) + Number(height)).toBeLessThanOrEqual(7.5 * EMU_PER_INCH + 1);
			}
		}
		// A card with room keeps its designed size.
		expect(all[0]).toContain('sz="5180"');
	});

	it("refuses images the request does not carry and links only web sources", async () => {
		const missing = await exportDeck({ document: deck(), assets: {}, sources });
		expect(missing.status).toBe(422);
		const unsafe = await exportDeck({
			document: deck(),
			assets,
			sources: [{ url: "javascript:alert(1)" }],
		});
		expect(unsafe.status).toBe(200);
		const { all, read } = await slides(unsafe);
		expect(all[2]).toContain("[1]");
		expect(await read("ppt/slides/_rels/slide3.xml.rels")).not.toContain("javascript");
	});

	it("estimates wrapping from word widths", () => {
		expect(wrappedLines("short", 20, 400, false)).toBe(1);
		expect(wrappedLines("word ".repeat(60), 20, 400, false)).toBeGreaterThan(3);
	});
});
