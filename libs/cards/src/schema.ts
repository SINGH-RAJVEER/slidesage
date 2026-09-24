/**
 * Version 1 of the card document: the authoritative, editable presentation.
 *
 * Content nodes carry stable IDs so edits address them directly rather than
 * by array position. Layout and theme are named choices from fixed lists, so
 * nothing in a document can inject styling or script.
 */
export const CARD_SCHEMA_VERSION = 1;

export const THEMES = ["slate", "paper", "ember"] as const;
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

export type ContentNode =
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
	sourceIds: 8,
} as const;
