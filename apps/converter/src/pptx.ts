import { deflateSync } from "node:zlib";
import type {
	Card,
	CardDocument,
	ColumnsNode,
	ContentNode,
	ImageNode,
	LayoutId,
	QuoteNode,
	RichText,
	StatNode,
	StepsNode,
	ThemeId,
} from "@slidesage/cards";
import PptxGenJS from "pptxgenjs";

/**
 * Writes a card document as a PowerPoint file of native, editable shapes:
 * text boxes, lists, and pictures, placed the way the web card view places
 * them. A card can grow taller than one slide in the browser; here its text
 * shrinks until it fits, down to a floor, and PowerPoint's own shrink-on-
 * overflow is left on for anything the estimate misses.
 */

/** A stored image the document shows. */
export interface ExportAsset {
	mimeType: string;
	width: number;
	height: number;
	/** The image bytes. */
	data: Uint8Array;
	source?: { type?: string; provider?: string; photographer?: string };
}

/** A research source, numbered by its position as the drafter cited it. */
export interface ExportSource {
	/** Absent when the source has no web link. */
	url?: string;
	title?: string;
}

export interface ExportInput {
	document: CardDocument;
	assets: Record<string, ExportAsset>;
	sources: ExportSource[];
}

// Slide geometry in inches. One "cqw" is 1% of the card width, the unit the
// web card view sizes everything in, so the numbers below match it directly.
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const CQW = SLIDE_W / 100;
const PT_PER_CQW = CQW * 72;
const FONT = "Arial";
/** Text never shrinks below this fraction of its designed size. */
const MIN_SCALE = 0.5;
/** How stock photo libraries are named in photo credits. */
const STOCK_LIBRARIES: Record<string, string> = { pexels: "Pexels", unsplash: "Unsplash" };

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
	const value = Number.parseInt(hex, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hex(color: Rgb): string {
	return color
		.map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}

/** A translucent color flattened onto the surface it sits on. */
function over(color: string, alpha: number, surface: string): string {
	const top = rgb(color);
	const bottom = rgb(surface);
	return hex(
		top.map((channel, index) => channel * alpha + (bottom[index] ?? 0) * (1 - alpha)) as Rgb,
	);
}

interface Palette {
	surface: string;
	heading: string;
	body: string;
	muted: string;
	accent: string;
	rule: string;
}

function palette(
	surface: string,
	heading: string,
	body: [string, number],
	muted: [string, number],
	accent: string,
	rule: [string, number],
): Palette {
	return {
		surface,
		heading,
		body: over(body[0], body[1], surface),
		muted: over(muted[0], muted[1], surface),
		accent,
		rule: over(rule[0], rule[1], surface),
	};
}

/** The web themes (libs/ui Cards/themes.ts) as solid colors. */
const PALETTES: Record<ThemeId, Palette> = {
	slate: palette("1B2130", "FFFFFF", ["FFFFFF", 0.8], ["FFFFFF", 0.45], "7DD3FC", ["FFFFFF", 0.1]),
	paper: palette("F7F5F0", "1D1F24", ["3A3D44", 1], ["7A7D85", 1], "B4532A", ["000000", 0.1]),
	ember: palette("231A17", "FBEEE4", ["F1D9C9", 0.85], ["F1D9C9", 0.45], "FF9B6A", [
		"F1D9C9",
		0.12,
	]),
};

/** Text over a cover photo, whatever the deck theme. */
const COVER_PALETTE: Palette = {
	surface: "000000",
	heading: "FFFFFF",
	body: "F2F2F2",
	muted: "D0D0D0",
	accent: "FFFFFF",
	rule: "FFFFFF",
};

// Text measurement. Widths are estimated from average glyph widths, and
// words wrap greedily, which is close enough to size text conservatively.
const AVERAGE_GLYPH = 0.52;
const AVERAGE_BOLD_GLYPH = 0.57;

function textWidthPt(text: string, sizePt: number, bold: boolean): number {
	return text.length * sizePt * (bold ? AVERAGE_BOLD_GLYPH : AVERAGE_GLYPH);
}

/** The number of lines a paragraph wraps to in a box widthPt wide. */
export function wrappedLines(text: string, sizePt: number, widthPt: number, bold: boolean): number {
	const space = textWidthPt(" ", sizePt, bold);
	let lines = 1;
	let used = 0;
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const width = textWidthPt(word, sizePt, bold);
		if (used > 0 && used + space + width > widthPt) {
			lines += 1;
			used = 0;
		}
		// A word wider than the box breaks across lines on its own.
		lines += Math.max(0, Math.ceil(width / widthPt) - 1);
		used += (used > 0 ? space : 0) + (width % widthPt || width);
	}
	return lines;
}

function plain(text: RichText): string {
	return text.map((run) => run.text).join("");
}

interface TextStyle {
	/** Designed size in cqw. */
	size: number;
	color: string;
	bold?: boolean;
	/** Line height as a multiple of the size. */
	leading: number;
}

/** One paragraph of a text box. */
interface Paragraph {
	runs: RichText;
	style: TextStyle;
	bullet?: boolean;
}

/** A block of content stacked in a card, sized for a width and a scale. */
interface Block {
	height(width: number, scale: number): number;
	draw(slide: PptxGenJS.Slide, x: number, y: number, width: number, scale: number): void;
}

const BULLET_INDENT_CQW = 2.1;

function lineHeightIn(style: TextStyle, scale: number): number {
	return (style.size * PT_PER_CQW * scale * style.leading) / 72;
}

/** A text box of paragraphs separated by `gap` cqw. */
function textBlock(paragraphs: Paragraph[], gap: number, align: "left" | "center" = "left"): Block {
	const measure = (width: number, scale: number) =>
		paragraphs.reduce((total, paragraph, index) => {
			const sizePt = paragraph.style.size * PT_PER_CQW * scale;
			const indent = paragraph.bullet ? BULLET_INDENT_CQW * CQW * scale : 0;
			const lines = wrappedLines(
				plain(paragraph.runs),
				sizePt,
				(width - indent) * 72,
				!!paragraph.style.bold,
			);
			return (
				total + lines * lineHeightIn(paragraph.style, scale) + (index > 0 ? gap * CQW * scale : 0)
			);
		}, 0);
	return {
		height: measure,
		draw(slide, x, y, width, scale) {
			const text: PptxGenJS.TextProps[] = paragraphs.flatMap((paragraph, index) => {
				const sizePt = paragraph.style.size * PT_PER_CQW * scale;
				const shared: PptxGenJS.TextPropsOptions = {
					fontSize: round(sizePt),
					color: paragraph.style.color,
					lineSpacing: round(sizePt * paragraph.style.leading),
					paraSpaceBefore: index > 0 ? round(gap * PT_PER_CQW * scale) : 0,
					bullet: paragraph.bullet
						? { characterCode: "25CF", indent: round(BULLET_INDENT_CQW * PT_PER_CQW * scale) }
						: false,
					align,
				};
				const runs = paragraph.runs.length > 0 ? paragraph.runs : [{ text: "" }];
				return runs.map((run, runIndex) => ({
					text: run.text,
					options: {
						...shared,
						bold: !!paragraph.style.bold || !!run.bold,
						italic: !!run.italic,
						breakLine: runIndex === runs.length - 1 && index < paragraphs.length - 1,
					},
				}));
			});
			slide.addText(text, {
				x,
				y,
				w: width,
				h: measure(width, scale),
				margin: 0,
				valign: "top",
				fontFace: FONT,
				fit: "shrink",
			});
		},
	};
}

function stack(blocks: Block[], gap: number): Block {
	const heights = (width: number, scale: number) =>
		blocks.map((block) => block.height(width, scale));
	return {
		height(width, scale) {
			const all = heights(width, scale);
			return (
				all.reduce((sum, value) => sum + value, 0) + Math.max(0, all.length - 1) * gap * CQW * scale
			);
		},
		draw(slide, x, y, width, scale) {
			let top = y;
			for (const block of blocks) {
				block.draw(slide, x, top, width, scale);
				top += block.height(width, scale) + gap * CQW * scale;
			}
		},
	};
}

/** Equal columns side by side, with an optional hairline on each. */
function row(
	columns: Block[],
	gap: number,
	rule?: { color: string; edge: "left" | "top"; inset: number },
): Block {
	const columnWidth = (width: number) =>
		(width - (columns.length - 1) * gap * CQW) / columns.length;
	const inset = (index: number, scale: number) => {
		if (!rule) return { x: 0, y: 0 };
		if (rule.edge === "top") return { x: 0, y: rule.inset * CQW * scale };
		return { x: index > 0 ? rule.inset * CQW : 0, y: 0 };
	};
	return {
		height(width, scale) {
			return Math.max(
				...columns.map((column, index) => {
					const offset = inset(index, scale);
					return column.height(columnWidth(width) - offset.x, scale) + offset.y;
				}),
			);
		},
		draw(slide, x, y, width, scale) {
			const height = this.height(width, scale);
			columns.forEach((column, index) => {
				const left = x + index * (columnWidth(width) + gap * CQW);
				const offset = inset(index, scale);
				if (rule && (rule.edge === "top" || index > 0)) {
					slide.addShape("line", {
						x: left,
						y,
						w: rule.edge === "top" ? columnWidth(width) : 0,
						h: rule.edge === "top" ? 0 : height,
						line: { color: rule.color, width: 0.75 },
					});
				}
				column.draw(slide, left + offset.x, y + offset.y, columnWidth(width) - offset.x, scale);
			});
		},
	};
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function nodesOf<T extends ContentNode["type"]>(card: Card, type: T) {
	return card.nodes.filter((node): node is Extract<ContentNode, { type: T }> => node.type === type);
}

function heading(card: Card, colors: Palette, large = false): Block[] {
	const [node] = nodesOf(card, "heading");
	if (!node) return [];
	return [
		textBlock(
			[
				{
					runs: node.text,
					style: { size: large ? 5.4 : 3.4, color: colors.heading, bold: true, leading: 1.1 },
				},
			],
			0,
		),
	];
}

function paragraphs(card: Card, colors: Palette, large = false): Block[] {
	return nodesOf(card, "paragraph").map((node) =>
		textBlock(
			[{ runs: node.text, style: { size: large ? 2.2 : 1.8, color: colors.body, leading: 1.3 } }],
			0,
		),
	);
}

function bullets(card: Card, colors: Palette): Block[] {
	return nodesOf(card, "bullets").map((node) =>
		textBlock(
			node.items.map((item) => ({
				runs: item.text,
				bullet: true,
				style: { size: 1.9, color: colors.body, leading: 1.3 },
			})),
			1.2,
		),
	);
}

function columns(node: ColumnsNode, colors: Palette): Block {
	return row(
		node.columns.map((column) =>
			stack(
				[
					textBlock(
						[
							{
								runs: [{ text: column.heading }],
								style: { size: 2.1, color: colors.accent, bold: true, leading: 1.2 },
							},
						],
						0,
					),
					textBlock(
						column.items.map((item) => ({
							runs: item.text,
							style: { size: 1.7, color: colors.body, leading: 1.3 },
						})),
						1,
					),
				],
				1.4,
			),
		),
		3,
		{ color: colors.rule, edge: "left", inset: 3 },
	);
}

function steps(node: StepsNode, colors: Palette): Block {
	return row(
		node.items.map((step, index) =>
			stack(
				[
					textBlock(
						[
							{
								runs: [{ text: String(index + 1).padStart(2, "0") }],
								style: { size: 1.6, color: colors.accent, bold: true, leading: 1.2 },
							},
						],
						0,
					),
					textBlock(
						[
							{
								runs: [{ text: step.title }],
								style: { size: 1.9, color: colors.heading, bold: true, leading: 1.2 },
							},
						],
						0,
					),
					...(step.detail
						? [
								textBlock(
									[{ runs: step.detail, style: { size: 1.5, color: colors.body, leading: 1.3 } }],
									0,
								),
							]
						: []),
				],
				1,
			),
		),
		2.4,
		{ color: colors.rule, edge: "top", inset: 1.6 },
	);
}

function stats(nodes: StatNode[], colors: Palette): Block {
	return row(
		nodes.map((stat) =>
			stack(
				[
					textBlock(
						[
							{
								runs: [{ text: stat.value }],
								style: { size: 5, color: colors.accent, bold: true, leading: 1.1 },
							},
						],
						0,
					),
					textBlock(
						[
							{
								runs: [{ text: stat.label }],
								style: { size: 1.6, color: colors.body, leading: 1.3 },
							},
						],
						0,
					),
				],
				0.6,
			),
		),
		3,
	);
}

function quote(node: QuoteNode, colors: Palette): Block {
	const style: TextStyle = { size: 3.2, color: colors.heading, leading: 1.2 };
	const quoted: Paragraph = {
		runs: [{ text: "“" }, ...node.text, { text: "”" }],
		style,
	};
	const blocks = [textBlock([quoted], 0)];
	if (node.attribution) {
		blocks.push(
			textBlock(
				[
					{
						runs: [{ text: node.attribution }],
						style: { size: 1.7, color: colors.muted, leading: 1.3 },
					},
				],
				0,
			),
		);
	}
	return stack(blocks, 2);
}

/** Where a layout's content sits in its box, and the gap between blocks. */
const ARRANGEMENT: Record<LayoutId, { justify: "start" | "center" | "end"; gap: number }> = {
	title: { justify: "center", gap: 2 },
	statement: { justify: "center", gap: 2.4 },
	bullets: { justify: "start", gap: 3 },
	comparison: { justify: "start", gap: 3 },
	process: { justify: "start", gap: 3.4 },
	quote: { justify: "center", gap: 2.4 },
	"image-left": { justify: "center", gap: 2.4 },
	"image-right": { justify: "center", gap: 2.4 },
	cover: { justify: "end", gap: 1.6 },
	stats: { justify: "center", gap: 3.4 },
};

/** The card's content blocks, in the order the web card view stacks them. */
function body(card: Card, colors: Palette): Block[] {
	switch (card.layout) {
		case "title":
			return [...heading(card, colors, true), ...paragraphs(card, colors, true)];
		case "statement":
			return [...heading(card, colors), ...paragraphs(card, colors, true)];
		case "bullets":
		case "image-left":
		case "image-right":
			return [...heading(card, colors), ...bullets(card, colors), ...paragraphs(card, colors)];
		case "comparison":
			return [
				...heading(card, colors),
				...nodesOf(card, "columns").map((node) => columns(node, colors)),
			];
		case "process":
			return [
				...heading(card, colors),
				...nodesOf(card, "steps").map((node) => steps(node, colors)),
			];
		case "quote":
			return [
				...heading(card, colors),
				...nodesOf(card, "quote").map((node) => quote(node, colors)),
			];
		case "cover":
			return [...heading(card, colors, true), ...paragraphs(card, colors, true)];
		case "stats":
			return [
				...heading(card, colors),
				stats(nodesOf(card, "stat"), colors),
				...paragraphs(card, colors),
			];
	}
}

/**
 * The largest text scale, at most 1, at which content fits the height. Below
 * the floor the text would be unreadable, so the floor is used and
 * PowerPoint's shrink-on-overflow takes over.
 */
export function fittingScale(content: Block, width: number, height: number): number {
	if (content.height(width, 1) <= height) return 1;
	let low = MIN_SCALE;
	let high = 1;
	for (let step = 0; step < 12; step += 1) {
		const middle = (low + high) / 2;
		if (content.height(width, middle) <= height) low = middle;
		else high = middle;
	}
	return low;
}

/** A picture filling a box the way CSS object-fit and object-position would. */
function placeImage(
	slide: PptxGenJS.Slide,
	node: ImageNode,
	asset: ExportAsset,
	box: { x: number; y: number; w: number; h: number },
) {
	const focus = node.focus ?? { x: 0.5, y: 0.5 };
	const data = `data:${asset.mimeType};base64,${Buffer.from(asset.data).toString("base64")}`;
	const ratio = asset.width / asset.height;
	if (node.fit === "contain") {
		const w = Math.min(box.w, box.h * ratio);
		const h = w / ratio;
		slide.addImage({
			data,
			altText: node.alt,
			x: box.x + (box.w - w) * focus.x,
			y: box.y + (box.h - h) * focus.y,
			w,
			h,
		});
		return;
	}
	const w = Math.max(box.w, box.h * ratio);
	const h = w / ratio;
	slide.addImage({
		data,
		altText: node.alt,
		x: box.x,
		y: box.y,
		w,
		h,
		sizing: {
			type: "crop",
			x: (w - box.w) * focus.x,
			y: (h - box.h) * focus.y,
			w: box.w,
			h: box.h,
		},
	});
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let index = 0; index < 256; index += 1) {
			let value = index;
			for (let bit = 0; bit < 8; bit += 1)
				value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
			crcTable[index] = value >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(12 + data.length);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, data.length);
	chunk.set(new TextEncoder().encode(type), 4);
	chunk.set(data, 8);
	view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
	return chunk;
}

/**
 * The cover card's scrim: black fading from 80% at the bottom to 5% at the
 * top, as a one-pixel-wide PNG stretched over the slide. PowerPoint shapes
 * made by pptxgenjs have no gradient fill.
 */
function coverScrim(): string {
	const height = 128;
	const pixels = new Uint8Array(height * 5);
	for (let y = 0; y < height; y += 1) {
		const t = y / (height - 1);
		// Tailwind's from-black/80 via-black/35 to-black/5, bottom to top.
		const alpha =
			t < 0.5 ? 0.05 + (0.35 - 0.05) * (t / 0.5) : 0.35 + (0.8 - 0.35) * ((t - 0.5) / 0.5);
		pixels[y * 5] = 0;
		pixels[y * 5 + 4] = Math.round(alpha * 255);
	}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, 1);
	view.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8);
	const parts = [
		new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(pixels)),
		pngChunk("IEND", new Uint8Array()),
	];
	return `data:image/png;base64,${Buffer.concat(parts).toString("base64")}`;
}

// Padding and footer, in cqw, as the web card view lays them out.
const PAD_X = 6;
const PAD_SPLIT = 5;
const PAD_TOP = 5;
const PAD_BOTTOM = 2.2;
const FOOTER_SIZE = 1.1;
const FOOTER_GAP = 2.8;

function footer(
	slide: PptxGenJS.Slide,
	card: Card,
	position: number,
	colors: Palette,
	x: number,
	width: number,
	sources: ExportSource[],
	asset: ExportAsset | undefined,
) {
	const sizePt = round(FOOTER_SIZE * PT_PER_CQW);
	const height = (FOOTER_SIZE * PT_PER_CQW * 1.4) / 72;
	const y = SLIDE_H - PAD_BOTTOM * CQW - height;
	const runs: PptxGenJS.TextProps[] = [];
	for (const id of card.sourceIds) {
		const number = Number(/^s(\d+)$/.exec(id)?.[1]);
		const source = sources[number - 1];
		if (!source) continue;
		runs.push({
			text: `[${number}]`,
			options: source.url
				? {
						hyperlink: { url: source.url, tooltip: source.title ?? source.url },
						color: colors.muted,
					}
				: {},
		});
		runs.push({ text: " " });
	}
	const credit = asset?.source;
	if (credit?.type === "stock" && credit.photographer) {
		const provider = STOCK_LIBRARIES[credit.provider ?? ""] ?? credit.provider ?? "";
		runs.push({ text: `Photo by ${credit.photographer} on ${provider}` });
	}
	const options = {
		y,
		h: height,
		margin: 0,
		fontFace: FONT,
		fontSize: sizePt,
		color: colors.muted,
	};
	if (runs.length > 0) slide.addText(runs, { ...options, x, w: width * 0.8, valign: "bottom" });
	slide.addText(String(position), {
		...options,
		x: x + width * 0.8,
		w: width * 0.2,
		align: "right",
	});
	return y;
}

function addCard(
	pptx: PptxGenJS,
	card: Card,
	position: number,
	theme: Palette,
	assets: Record<string, ExportAsset>,
	sources: ExportSource[],
	scrim: () => string,
) {
	const slide = pptx.addSlide();
	slide.background = { color: theme.surface };
	const [image] = nodesOf(card, "image");
	const asset = image ? assets[image.assetId] : undefined;
	const split = card.layout === "image-left" || card.layout === "image-right";
	const cover = card.layout === "cover";
	const colors = cover ? COVER_PALETTE : theme;

	let x = PAD_X * CQW;
	let width = SLIDE_W - 2 * PAD_X * CQW;
	if (split) {
		const half = SLIDE_W / 2;
		const imageLeft = card.layout === "image-left";
		if (image && asset)
			placeImage(slide, image, asset, { x: imageLeft ? 0 : half, y: 0, w: half, h: SLIDE_H });
		x = (imageLeft ? half : 0) + PAD_SPLIT * CQW;
		width = half - 2 * PAD_SPLIT * CQW;
	}
	if (cover && image && asset) {
		placeImage(slide, image, asset, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
		slide.addImage({ data: scrim(), x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, altText: "" });
	}

	const footerTop = footer(slide, card, position, colors, x, width, sources, asset);
	const top = PAD_TOP * CQW;
	const available = footerTop - FOOTER_GAP * CQW - top;
	const arrangement = ARRANGEMENT[card.layout];
	const content = stack(body(card, colors), arrangement.gap);
	const scale = fittingScale(content, width, available);
	const height = Math.min(content.height(width, scale), available);
	const offset =
		arrangement.justify === "center"
			? (available - height) / 2
			: arrangement.justify === "end"
				? available - height
				: 0;
	content.draw(slide, x, top + offset, width, scale);
	if (card.notes) slide.addNotes(card.notes);
}

/** Writes the document as PPTX file bytes. */
export async function writePptx({ document, assets, sources }: ExportInput): Promise<Uint8Array> {
	const pptx = new PptxGenJS();
	pptx.layout = "LAYOUT_WIDE";
	pptx.title = document.title;
	pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
	const theme = PALETTES[document.theme];
	let scrim: string | undefined;
	document.cardOrder.forEach((id, index) => {
		const card = document.cards[id];
		if (card)
			addCard(pptx, card, index + 1, theme, assets, sources, () => (scrim ??= coverScrim()));
	});
	return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}
