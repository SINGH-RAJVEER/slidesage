/**
 * Version 2 of the card document: the authoritative, editable presentation.
 *
 * Content nodes carry stable IDs so edits address them directly rather than
 * by array position. Layout and theme are named choices from fixed lists, so
 * nothing in a document can inject styling or script.
 *
 * Version 2 adds image nodes and the layouts that hold them. Version 3 adds
 * data widgets (charts, meters, tables, and callouts) and the layouts that
 * hold them. Earlier documents are still read and are upgraded on read; only
 * version 3 is written.
 */
export const CARD_SCHEMA_VERSION = 3;

/** Schema versions this build can read. */
export const READABLE_SCHEMA_VERSIONS = [1, 2, 3] as const;

export const THEMES = [
	"slate",
	"paper",
	"ember",
	"ocean",
	"grove",
	"orchid",
	"sand",
	"cobalt",
	"mono",
] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = "slate";

export const NARRATIVE_ROLES = [
	"opening",
	"context",
	"evidence",
	"comparison",
	"process",
	"insight",
	"closing",
] as const;
export type NarrativeRole = (typeof NARRATIVE_ROLES)[number];

export const LAYOUTS = [
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
] as const;
export type LayoutId = (typeof LAYOUTS)[number];

/** A run of text with optional emphasis. Links are deliberately absent. */
export interface TextRun {
	text: string;
	bold?: true;
	italic?: true;
}

export type RichText = TextRun[];

export interface HeadingNode {
	id: string;
	type: "heading";
	text: RichText;
}

export interface ParagraphNode {
	id: string;
	type: "paragraph";
	text: RichText;
}

export interface ListItem {
	id: string;
	text: RichText;
}

export interface BulletsNode {
	id: string;
	type: "bullets";
	items: ListItem[];
}

export interface QuoteNode {
	id: string;
	type: "quote";
	text: RichText;
	attribution?: string;
}

export interface StatNode {
	id: string;
	type: "stat";
	value: string;
	label: string;
}

export interface Step {
	id: string;
	title: string;
	detail?: RichText;
}

export interface StepsNode {
	id: string;
	type: "steps";
	items: Step[];
}

export interface Column {
	id: string;
	heading: string;
	items: ListItem[];
}

export interface ColumnsNode {
	id: string;
	type: "columns";
	columns: Column[];
}

/**
 * An image the server registered for this presentation. The document holds only
 * the asset's digest; dimensions, format, and attribution live on the server,
 * which also checks that every referenced asset belongs to the presentation.
 */
export interface ImageNode {
	id: string;
	type: "image";
	/** SHA-256 of stored bytes, or of `provider:providerId` for a hotlinked photo. */
	assetId: string;
	alt: string;
	/** "cover" fills the frame and crops around the focus; "contain" letterboxes. */
	fit: "cover" | "contain";
	/** Crop focus as fractions of width and height, 0.5 each by default. */
	focus?: { x: number; y: number };
}

/**
 * How much room a widget takes. In a dashboard it is the widget's share of a
 * row; beside text it is the widget's share of the card's width, and a full
 * widget sits above the text instead.
 */
export const WIDGET_SIZES = ["small", "medium", "large", "full"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export const CHART_KINDS = [
	"column",
	"bar",
	"stacked-column",
	"line",
	"area",
	"pie",
	"donut",
] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartSeries {
	id: string;
	name: string;
	/** One value per category, in category order. */
	values: number[];
}

/** A chart of real figures. Colors come from the theme, never the document. */
export interface ChartNode {
	id: string;
	type: "chart";
	kind: ChartKind;
	size: WidgetSize;
	categories: string[];
	series: ChartSeries[];
	/** Written before and after every value, such as "$" and "B". */
	prefix?: string;
	suffix?: string;
	/** Where the figures come from, shown under the chart. */
	caption?: string;
}

export interface Meter {
	id: string;
	label: string;
	/** A percentage from 0 to 100. */
	value: number;
}

/** Labelled meters, each filled to a percentage. */
export interface ProgressNode {
	id: string;
	type: "progress";
	size: WidgetSize;
	items: Meter[];
}

export interface TableRow {
	id: string;
	/** One cell per column. */
	cells: string[];
}

export interface TableNode {
	id: string;
	type: "table";
	size: WidgetSize;
	/** Column headings. */
	columns: string[];
	rows: TableRow[];
}

export const CALLOUT_TONES = ["note", "positive", "caution"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** A highlighted remark. Its tone is shown with an icon, never color alone. */
export interface CalloutNode {
	id: string;
	type: "callout";
	size: WidgetSize;
	tone: CalloutTone;
	text: RichText;
}

export type WidgetNode = ChartNode | ProgressNode | TableNode | CalloutNode;
export const WIDGET_TYPES = ["chart", "progress", "table", "callout"] as const;
export type WidgetType = WidgetNode["type"];

export type ContentNode =
	| ChartNode
	| ProgressNode
	| TableNode
	| CalloutNode
	| ImageNode
	| HeadingNode
	| ParagraphNode
	| BulletsNode
	| QuoteNode
	| StatNode
	| StepsNode
	| ColumnsNode;

export type ContentNodeType = ContentNode["type"];

export interface Card {
	id: string;
	/** The one point this card makes. */
	takeaway: string;
	role: NarrativeRole;
	layout: LayoutId;
	nodes: ContentNode[];
	/** IDs of the research sources the card draws on. */
	sourceIds: string[];
	notes?: string;
}

export interface CardDocument {
	schemaVersion: typeof CARD_SCHEMA_VERSION;
	title: string;
	theme: ThemeId;
	cardOrder: string[];
	cards: Record<string, Card>;
}

export const LIMITS = {
	cards: { min: 1, max: 40 },
	title: 120,
	takeaway: 200,
	notes: 1200,
	heading: 90,
	paragraph: 420,
	listItem: 160,
	quote: 280,
	attribution: 80,
	statValue: 16,
	statLabel: 60,
	stepTitle: 60,
	stepDetail: 200,
	columnHeading: 40,
	imageAlt: 200,
	sourceIds: 8,
	chartCategories: { min: 2, max: 12 },
	chartSeries: { min: 1, max: 4 },
	categoryLabel: 24,
	seriesName: 40,
	affix: 8,
	chartCaption: 120,
	/** The largest magnitude a chart value may have. */
	chartValue: 1e12,
	meters: { min: 1, max: 6 },
	meterLabel: 60,
	tableColumns: { min: 2, max: 5 },
	tableRows: { min: 1, max: 8 },
	tableHeading: 32,
	tableCell: 60,
	callout: 240,
} as const;
