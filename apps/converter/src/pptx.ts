import { deflateSync } from "node:zlib";
import type {
	CalloutNode,
	Card,
	CardDocument,
	CardThemeDefinition,
	ChartNode,
	ChartPalette,
	ColumnsNode,
	ContentNode,
	ImageNode,
	LayoutId,
	ProgressNode,
	QuoteNode,
	RichText,
	StatNode,
	StepsNode,
	TableNode,
	ThemePalette,
	WidgetNode,
} from "@slidesage/cards";
import {
	CARD_THEME_DEFINITIONS,
	COVER_PALETTE,
	FEATURE_TEXT,
	featureSplit,
	isWidget,
	PIE_KINDS,
	STOCK_LIBRARIES,
	widgetRows,
} from "@slidesage/cards";
import PptxGenJS from "pptxgenjs";

/**
 * Writes a card document as a PowerPoint file of native, editable shapes:
 * text boxes, lists, pictures, charts, and tables, placed the way the web
 * card view places them. A card can grow taller than one slide in the browser; here its text
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
	source?: { type?: string; provider?: string; photographer?: string; photographerUrl?: string };
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
/** Text never shrinks below this fraction of its designed size. */
const MIN_SCALE = 0.5;

interface Palette extends ThemePalette {
	fonts: CardThemeDefinition["fonts"];
	chart: ChartPalette;
}

/** PPTX uses bare hex values while CSS uses # prefixes. */
const bare = (color: string) => color.slice(1).toUpperCase();

/** The theme's colors without # prefixes. `chart` is already converted. */
function exportPalette(
	palette: ThemePalette,
	fonts: Palette["fonts"],
	chart: ChartPalette,
): Palette {
	return {
		...(Object.fromEntries(
			Object.entries(palette).map(([key, color]) => [key, bare(color)]),
		) as Record<keyof ThemePalette, string>),
		fonts,
		chart,
	};
}

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
	fontFace: string;
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

/**
 * A block of content stacked in a card, sized for a width and a scale. Its
 * height is the least it needs; a block that can grow, such as a chart, fills
 * the `height` it is drawn into.
 */
interface Block {
	height(width: number, scale: number): number;
	draw(
		slide: PptxGenJS.Slide,
		x: number,
		y: number,
		width: number,
		scale: number,
		height?: number,
	): void;
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
					fontFace: paragraph.style.fontFace,
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
				fit: "shrink",
			});
		},
	};
}

/**
 * Blocks one above another. Given a height to fill, the last block receives
 * whatever the others leave, so a chart at the bottom of a card grows.
 */
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
		draw(slide, x, y, width, scale, height) {
			let top = y;
			blocks.forEach((block, index) => {
				const own = block.height(width, scale);
				const last = index === blocks.length - 1;
				block.draw(
					slide,
					x,
					top,
					width,
					scale,
					last && height !== undefined ? y + height - top : own,
				);
				top += own + gap * CQW * scale;
			});
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
					style: {
						fontFace: colors.fonts.heading.face,
						size: large ? 5.4 : 3.4,
						color: colors.heading,
						bold: true,
						leading: 1.1,
					},
				},
			],
			0,
		),
	];
}

function paragraphs(card: Card, colors: Palette, large = false): Block[] {
	return nodesOf(card, "paragraph").map((node) =>
		textBlock(
			[
				{
					runs: node.text,
					style: {
						fontFace: colors.fonts.body.face,
						size: large ? 2.2 : 1.8,
						color: colors.body,
						leading: 1.3,
					},
				},
			],
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
				style: { fontFace: colors.fonts.body.face, size: 1.9, color: colors.body, leading: 1.3 },
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
								style: {
									fontFace: colors.fonts.heading.face,
									size: 2.1,
									color: colors.accent,
									bold: true,
									leading: 1.2,
								},
							},
						],
						0,
					),
					textBlock(
						column.items.map((item) => ({
							runs: item.text,
							style: {
								fontFace: colors.fonts.body.face,
								size: 1.7,
								color: colors.body,
								leading: 1.3,
							},
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
								style: {
									fontFace: colors.fonts.body.face,
									size: 1.6,
									color: colors.accent,
									bold: true,
									leading: 1.2,
								},
							},
						],
						0,
					),
					textBlock(
						[
							{
								runs: [{ text: step.title }],
								style: {
									fontFace: colors.fonts.heading.face,
									size: 1.9,
									color: colors.heading,
									bold: true,
									leading: 1.2,
								},
							},
						],
						0,
					),
					...(step.detail
						? [
								textBlock(
									[
										{
											runs: step.detail,
											style: {
												fontFace: colors.fonts.body.face,
												size: 1.5,
												color: colors.body,
												leading: 1.3,
											},
										},
									],
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
								style: {
									fontFace: colors.fonts.heading.face,
									size: 5,
									color: colors.accent,
									bold: true,
									leading: 1.1,
								},
							},
						],
						0,
					),
					textBlock(
						[
							{
								runs: [{ text: stat.label }],
								style: {
									fontFace: colors.fonts.body.face,
									size: 1.6,
									color: colors.body,
									leading: 1.3,
								},
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
	const style: TextStyle = {
		fontFace: colors.fonts.heading.face,
		size: 3.2,
		color: colors.heading,
		leading: 1.2,
	};
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
						style: {
							fontFace: colors.fonts.body.face,
							size: 1.7,
							color: colors.muted,
							leading: 1.3,
						},
					},
				],
				0,
			),
		);
	}
	return stack(blocks, 2);
}

// Widgets. Sizes are in cqw, as in the web card view's widgets.

/** The least height a chart's plot takes, as in the browser. */
const CHART_MIN = 12;
const WIDGET_GAP_X = 3;
const DASHBOARD_GAP_Y = 2.4;

/** An Excel number format writing a chart's prefix and suffix around its values. */
function numberFormat(node: ChartNode): string {
	const quote = (text?: string) => (text ? `"${text.replace(/"/g, "")}"` : "");
	const whole = node.series.every((series) => series.values.every(Number.isInteger));
	return `${quote(node.prefix)}#,##0${whole ? "" : ".0#"}${quote(node.suffix)}`;
}

const CHART_TYPES: Record<ChartNode["kind"], "bar" | "line" | "area" | "pie" | "doughnut"> = {
	column: "bar",
	bar: "bar",
	"stacked-column": "bar",
	line: "line",
	area: "area",
	pie: "pie",
	donut: "doughnut",
};

/**
 * A native PowerPoint chart of the node's data, editable in PowerPoint's own
 * data sheet, in the theme's series colors. Its plot fills the height left
 * after the caption.
 */
function chart(node: ChartNode, colors: Palette): Block {
	const caption = node.caption
		? textBlock(
				[
					{
						runs: [{ text: node.caption }],
						style: {
							fontFace: colors.fonts.body.face,
							size: 1.1,
							color: colors.muted,
							leading: 1.3,
						},
					},
				],
				0,
			)
		: undefined;
	const captionHeight = (width: number, scale: number) =>
		caption ? caption.height(width, scale) + CQW * scale : 0;
	return {
		height: (width, scale) => CHART_MIN * CQW * scale + captionHeight(width, scale),
		draw(slide, x, y, width, scale, height) {
			const total = height ?? this.height(width, scale);
			const plot = total - captionHeight(width, scale);
			const pie = PIE_KINDS.includes(node.kind);
			const labelPt = round(1.25 * PT_PER_CQW * scale);
			const legendPt = round((pie ? 1.4 : 1.3) * PT_PER_CQW * scale);
			const single = node.series.length === 1;
			const format = numberFormat(node);
			const options: PptxGenJS.IChartOpts = {
				x,
				y,
				w: width,
				h: plot,
				altText: `${node.kind} chart of ${node.series.map((series) => series.name).join(", ")}`,
				chartColors: colors.chart.series.slice(
					0,
					pie ? node.categories.length : node.series.length,
				),
				chartArea: { fill: { color: colors.surface }, roundedCorners: false },
				plotArea: { fill: { color: colors.surface } },
				showLegend: pie || !single,
				legendPos: pie ? "r" : "t",
				legendColor: colors.body,
				legendFontFace: colors.fonts.body.face,
				legendFontSize: legendPt,
				dataLabelColor: colors.heading,
				dataLabelFontFace: colors.fonts.body.face,
				dataLabelFontSize: labelPt,
				dataLabelFontBold: true,
				dataLabelFormatCode: format,
			};
			if (pie) {
				Object.assign(options, {
					showPercent: true,
					showValue: false,
					dataLabelPosition: "bestFit",
					dataLabelFormatCode: "0%",
					dataBorder: { pt: 1.5, color: colors.surface },
					holeSize: 62,
					firstSliceAng: 0,
				} satisfies PptxGenJS.IChartOpts);
			} else {
				Object.assign(options, {
					catAxisLabelColor: colors.muted,
					catAxisLabelFontFace: colors.fonts.body.face,
					catAxisLabelFontSize: labelPt,
					catAxisLineColor: colors.muted,
					catGridLine: { style: "none" },
					valAxisLabelColor: colors.muted,
					valAxisLabelFontFace: colors.fonts.body.face,
					valAxisLabelFontSize: labelPt,
					valAxisLabelFormatCode: format,
					valAxisLineShow: false,
					valGridLine: { color: colors.rule, size: 0.75, style: "solid" },
				} satisfies PptxGenJS.IChartOpts);
			}
			if (node.kind === "column" || node.kind === "bar" || node.kind === "stacked-column") {
				const labelled = single && node.categories.length <= 8 && node.kind !== "stacked-column";
				Object.assign(options, {
					barDir: node.kind === "bar" ? "bar" : "col",
					barGrouping: node.kind === "stacked-column" ? "stacked" : "clustered",
					barGapWidthPct: 40,
					showValue: labelled,
					dataLabelPosition: "outEnd",
					// A horizontal chart lists its first category at the top, as the browser does.
					...(node.kind === "bar" ? { catAxisOrientation: "maxMin" as const } : {}),
					...(node.kind === "bar" && labelled
						? { valAxisHidden: true, valGridLine: { style: "none" as const } }
						: {}),
				});
			}
			if (node.kind === "line" || node.kind === "area") {
				Object.assign(options, {
					lineSize: 2,
					lineDataSymbol: node.kind === "line" ? "circle" : "none",
					lineDataSymbolSize: round(0.6 * PT_PER_CQW * scale + 2),
					lineDataSymbolLineColor: colors.surface,
					lineDataSymbolLineSize: 1.5,
					chartColorsOpacity: node.kind === "area" ? 40 : undefined,
				} satisfies PptxGenJS.IChartOpts);
			}
			slide.addChart(
				CHART_TYPES[node.kind] as PptxGenJS.CHART_NAME,
				node.series.map((series) => ({
					name: series.name,
					labels: node.categories,
					values: series.values,
				})),
				options,
			);
			caption?.draw(slide, x, y + plot + CQW * scale, width, scale);
		},
	};
}

const NUMERIC_CELL = /^[-+−]?[$€£¥₹]?\s?[\d.,]+\s?(%|[A-Za-z]{1,3})?$/;
const CELL_PAD_X = 1;
const CELL_PAD_Y = 0.75;

/** A native table: headings over a heavier rule, rows over hairlines, figures aligned right. */
function table(node: TableNode, colors: Palette): Block {
	const size = 1.5;
	const leading = 1.3;
	const numeric = node.columns.map((_, column) => {
		const cells = node.rows.map((row) => row.cells[column] ?? "").filter(Boolean);
		return cells.length > 0 && cells.every((cell) => NUMERIC_CELL.test(cell.trim()));
	});
	const rows = [node.columns, ...node.rows.map((row) => row.cells)];
	const rowHeights = (width: number, scale: number) => {
		const columnWidth = width / node.columns.length - 2 * CELL_PAD_X * CQW * scale;
		const sizePt = size * PT_PER_CQW * scale;
		return rows.map((cells, index) => {
			const lines = Math.max(
				1,
				...cells.map((cell) => wrappedLines(cell || " ", sizePt, columnWidth * 72, index === 0)),
			);
			return (lines * sizePt * leading) / 72 + 2 * CELL_PAD_Y * CQW * scale;
		});
	};
	return {
		height: (width, scale) => rowHeights(width, scale).reduce((sum, value) => sum + value, 0),
		draw(slide, x, y, width, scale) {
			const sizePt = round(size * PT_PER_CQW * scale);
			const none = { type: "none" as const };
			const line = (pt: number) => ({ type: "solid" as const, pt, color: colors.rule });
			const margin = [CELL_PAD_Y, CELL_PAD_X, CELL_PAD_Y, CELL_PAD_X].map((value) =>
				round(value * PT_PER_CQW * scale),
			) as [number, number, number, number];
			slide.addTable(
				rows.map((cells, index) =>
					cells.map((cell, column) => ({
						text: cell,
						options: {
							bold: index === 0,
							fontFace: index === 0 ? colors.fonts.heading.face : colors.fonts.body.face,
							color: index === 0 ? colors.heading : colors.body,
							align: numeric[column] ? "right" : "left",
							border: [none, none, line(index === 0 ? 1.5 : 0.75), none],
						} satisfies PptxGenJS.TableCellProps,
					})),
				),
				{
					x,
					y,
					w: width,
					colW: node.columns.map(() => width / node.columns.length),
					rowH: rowHeights(width, scale),
					fontSize: sizePt,
					margin,
					valign: "top",
				},
			);
		},
	};
}

/** Labelled meters: a label and percentage over a rounded track filled to the value. */
function progress(node: ProgressNode, colors: Palette): Block {
	const meters = node.items.map((meter) => ({
		meter,
		label: textBlock(
			[
				{
					runs: [{ text: meter.label }],
					style: { fontFace: colors.fonts.body.face, size: 1.6, color: colors.body, leading: 1.3 },
				},
			],
			0,
		),
	}));
	const track = 0.8;
	const valueWidth = (scale: number) => 1.6 * 3.2 * CQW * scale;
	const meterHeight = (entry: (typeof meters)[number], width: number, scale: number) =>
		entry.label.height(width - valueWidth(scale), scale) + (0.6 + track) * CQW * scale;
	return {
		height: (width, scale) =>
			meters.reduce((sum, entry) => sum + meterHeight(entry, width, scale), 0) +
			Math.max(0, meters.length - 1) * 1.6 * CQW * scale,
		draw(slide, x, y, width, scale) {
			let top = y;
			for (const entry of meters) {
				const labelWidth = width - valueWidth(scale);
				const labelHeight = entry.label.height(labelWidth, scale);
				entry.label.draw(slide, x, top, labelWidth, scale);
				slide.addText(`${entry.meter.value}%`, {
					x: x + labelWidth,
					y: top,
					w: valueWidth(scale),
					h: labelHeight,
					margin: 0,
					align: "right",
					valign: "top",
					bold: true,
					fontFace: colors.fonts.heading.face,
					fontSize: round(1.6 * PT_PER_CQW * scale),
					color: colors.heading,
				});
				const trackTop = top + labelHeight + 0.6 * CQW * scale;
				const trackHeight = track * CQW * scale;
				slide.addShape("roundRect", {
					x,
					y: trackTop,
					w: width,
					h: trackHeight,
					rectRadius: trackHeight / 2,
					fill: { color: colors.rule },
					line: { type: "none" },
				});
				if (entry.meter.value > 0) {
					slide.addShape("roundRect", {
						x,
						y: trackTop,
						w: Math.max(trackHeight, (width * entry.meter.value) / 100),
						h: trackHeight,
						rectRadius: trackHeight / 2,
						fill: { color: colors.chart.series[0] ?? colors.accent },
						line: { type: "none" },
					});
				}
				top += meterHeight(entry, width, scale) + 1.6 * CQW * scale;
			}
		},
	};
}

const TONE_MARKS: Record<CalloutNode["tone"], string> = { note: "i", positive: "✓", caution: "!" };

/** A remark beside a rule in its tone's color, marked with the tone's sign. */
function callout(node: CalloutNode, colors: Palette): Block {
	const color =
		node.tone === "positive"
			? colors.chart.positive
			: node.tone === "caution"
				? colors.chart.caution
				: colors.accent;
	const inset = (scale: number) => (0.35 + 1.6 + 2 + 1.2) * CQW * scale;
	const text = textBlock(
		[
			{
				runs: node.text,
				style: { fontFace: colors.fonts.body.face, size: 1.7, color: colors.body, leading: 1.3 },
			},
		],
		0,
	);
	const pad = 0.3;
	return {
		height: (width, scale) => text.height(width - inset(scale), scale) + 2 * pad * CQW * scale,
		draw(slide, x, y, width, scale) {
			const height = this.height(width, scale);
			slide.addShape("rect", {
				x,
				y,
				w: 0.35 * CQW * scale,
				h: height,
				fill: { color },
				line: { type: "none" },
			});
			slide.addText(TONE_MARKS[node.tone], {
				x: x + (0.35 + 1.6) * CQW * scale,
				y: y + pad * CQW * scale,
				w: 2 * CQW * scale,
				h: 2 * CQW * scale,
				margin: 0,
				align: "center",
				valign: "middle",
				bold: true,
				fontFace: colors.fonts.body.face,
				fontSize: round(1.4 * PT_PER_CQW * scale),
				color,
			});
			text.draw(slide, x + inset(scale), y + pad * CQW * scale, width - inset(scale), scale);
		},
	};
}

function widget(node: WidgetNode, colors: Palette): Block {
	switch (node.type) {
		case "chart":
			return chart(node, colors);
		case "table":
			return table(node, colors);
		case "progress":
			return progress(node, colors);
		case "callout":
			return callout(node, colors);
	}
}

/** A block centered in the height it is drawn into, unless it grows to fill it. */
function centered(block: Block, grows: boolean): Block {
	return {
		height: (width, scale) => block.height(width, scale),
		draw(slide, x, y, width, scale, height) {
			const own = block.height(width, scale);
			if (grows || height === undefined) return block.draw(slide, x, y, width, scale, height);
			block.draw(slide, x, y + Math.max(0, (height - own) / 2), width, scale);
		},
	};
}

/**
 * The body of a chart or table card: its widget beside the text at its
 * size's share of the width, or above the text at full size. A chart grows
 * into the height left over; a table keeps its own.
 */
function feature(card: Card, colors: Palette): Block {
	const node = card.nodes.find((entry): entry is WidgetNode => entry.type === card.layout);
	const text = card.nodes.filter((entry) => entry !== node && FEATURE_TEXT.includes(entry.type));
	const textBlocks = stack(
		text.map((entry) =>
			entry.type === "callout"
				? callout(entry, colors)
				: entry.type === "bullets"
					? textBlock(
							entry.items.map((item) => ({
								runs: item.text,
								bullet: true,
								style: {
									fontFace: colors.fonts.body.face,
									size: 1.9,
									color: colors.body,
									leading: 1.3,
								},
							})),
							1.2,
						)
					: textBlock(
							[
								{
									runs: entry.type === "paragraph" ? entry.text : [],
									style: {
										fontFace: colors.fonts.body.face,
										size: 1.8,
										color: colors.body,
										leading: 1.3,
									},
								},
							],
							0,
						),
		),
		1.8,
	);
	if (!node) return textBlocks;
	const content = widget(node, colors);
	const grows = node.type === "chart";
	const split = featureSplit(node.size, text.length > 0);
	if (split.direction === "row") {
		const widths = (width: number, scale: number) => {
			const room = width - WIDGET_GAP_X * CQW * scale;
			return [room * split.share, room * (1 - split.share)] as const;
		};
		return {
			height(width, scale) {
				const [left, right] = widths(width, scale);
				return Math.max(content.height(left, scale), textBlocks.height(right, scale));
			},
			draw(slide, x, y, width, scale, height) {
				const total = height ?? this.height(width, scale);
				const [left, right] = widths(width, scale);
				content.draw(slide, x, y, left, scale, grows ? total : undefined);
				centered(textBlocks, false).draw(
					slide,
					x + left + WIDGET_GAP_X * CQW * scale,
					y,
					right,
					scale,
					total,
				);
			},
		};
	}
	const gap = (scale: number) => (text.length > 0 ? WIDGET_GAP_X * CQW * scale : 0);
	return {
		height: (width, scale) =>
			content.height(width, scale) +
			gap(scale) +
			(text.length > 0 ? textBlocks.height(width, scale) : 0),
		draw(slide, x, y, width, scale, height) {
			const textHeight = text.length > 0 ? textBlocks.height(width, scale) : 0;
			const total = height ?? this.height(width, scale);
			const own = grows ? total - textHeight - gap(scale) : content.height(width, scale);
			content.draw(slide, x, y, width, scale, own);
			if (text.length > 0) textBlocks.draw(slide, x, y + own + gap(scale), width, scale);
		},
	};
}

/** Dashboard widgets in rows that share the height; each widget takes its share of its row. */
function dashboard(card: Card, colors: Palette): Block {
	const rows = widgetRows(card.nodes.filter(isWidget)).map((cells) =>
		cells.map((cell) => ({
			...cell,
			block: widget(cell.widget, colors),
			grows: cell.widget.type === "chart",
		})),
	);
	const cellWidths = (row: (typeof rows)[number], width: number, scale: number) => {
		const room = width - Math.max(0, row.length - 1) * WIDGET_GAP_X * CQW * scale;
		return row.map((cell) => room * cell.width);
	};
	const rowHeight = (row: (typeof rows)[number], width: number, scale: number) => {
		const widths = cellWidths(row, width, scale);
		return Math.max(...row.map((cell, index) => cell.block.height(widths[index] ?? 0, scale)));
	};
	const gaps = (scale: number) => Math.max(0, rows.length - 1) * DASHBOARD_GAP_Y * CQW * scale;
	return {
		height: (width, scale) =>
			rows.reduce((sum, row) => sum + rowHeight(row, width, scale), 0) + gaps(scale),
		draw(slide, x, y, width, scale, height) {
			const natural = rows.map((row) => rowHeight(row, width, scale));
			// Rows share the height equally, as flex rows do, unless one needs more.
			const spare = Math.max(0, (height ?? this.height(width, scale)) - gaps(scale));
			const even = spare / rows.length;
			const tall = natural.filter((value) => value > even);
			const rest =
				(spare - tall.reduce((sum, value) => sum + value, 0)) / (rows.length - tall.length || 1);
			let top = y;
			rows.forEach((row, rowIndex) => {
				const own = Math.max(natural[rowIndex] ?? 0, tall.length ? rest : even);
				const widths = cellWidths(row, width, scale);
				let left = x;
				row.forEach((cell, index) => {
					const cellWidth = widths[index] ?? 0;
					centered(cell.block, cell.grows).draw(slide, left, top, cellWidth, scale, own);
					left += cellWidth + WIDGET_GAP_X * CQW * scale;
				});
				top += own + DASHBOARD_GAP_Y * CQW * scale;
			});
		},
	};
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
	chart: { justify: "start", gap: 2.6 },
	table: { justify: "start", gap: 2.6 },
	dashboard: { justify: "start", gap: 2.6 },
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
		case "chart":
		case "table":
			return [...heading(card, colors), feature(card, colors)];
		case "dashboard":
			return [...heading(card, colors), dashboard(card, colors)];
	}
}

/**
 * The largest text scale, at most 1, at which content fits the height. Below
 * the floor the text would be unreadable, so the floor is used and
 * PowerPoint's shrink-on-overflow takes over.
 */
function fittingScale(content: Block, width: number, height: number): number {
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
		// "Photo by X on Library", with both names linked as the libraries ask.
		const library = STOCK_LIBRARIES[credit.provider ?? ""];
		const link = (url: string | undefined) =>
			url ? { hyperlink: { url }, color: colors.muted } : {};
		runs.push(
			{ text: "Photo by " },
			{ text: credit.photographer, options: link(credit.photographerUrl) },
			{ text: " on " },
			{ text: library?.name ?? credit.provider ?? "", options: link(library?.url) },
		);
	}
	const options = {
		y,
		h: height,
		margin: 0,
		fontFace: colors.fonts.body.face,
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
	const colors = cover ? exportPalette(COVER_PALETTE, theme.fonts, theme.chart) : theme;

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
	// Widget cards fill the slide, so their charts grow into the room left.
	const fills = card.layout === "chart" || card.layout === "table" || card.layout === "dashboard";
	content.draw(slide, x, top + offset, width, scale, fills ? available : undefined);
	if (card.notes) slide.addNotes(card.notes);
}

/** Writes the document as PPTX file bytes. */
export async function writePptx({ document, assets, sources }: ExportInput): Promise<Uint8Array> {
	const pptx = new PptxGenJS();
	pptx.layout = "LAYOUT_WIDE";
	pptx.title = document.title;
	const definition = CARD_THEME_DEFINITIONS[document.theme];
	pptx.theme = {
		headFontFace: definition.fonts.heading.face,
		bodyFontFace: definition.fonts.body.face,
	};
	const theme = exportPalette(definition.palette, definition.fonts, {
		series: definition.chart.series.map(bare),
		positive: bare(definition.chart.positive),
		caution: bare(definition.chart.caution),
	});
	let scrim: string | undefined;
	document.cardOrder.forEach((id, index) => {
		const card = document.cards[id];
		if (card)
			addCard(pptx, card, index + 1, theme, assets, sources, () => (scrim ??= coverScrim()));
	});
	return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}
