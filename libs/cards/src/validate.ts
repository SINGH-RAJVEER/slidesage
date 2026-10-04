import { layoutMismatch } from "./layouts";
import {
	CALLOUT_TONES,
	CARD_SCHEMA_VERSION,
	type Card,
	type CardDocument,
	CHART_KINDS,
	type ChartNode,
	type Column,
	type ContentNode,
	LAYOUTS,
	LIMITS,
	type ListItem,
	NARRATIVE_ROLES,
	READABLE_SCHEMA_VERSIONS,
	type RichText,
	type Step,
	type TextRun,
	THEMES,
	WIDGET_SIZES,
} from "./schema";
import { chartKindMismatch } from "./widgets";

export interface SchemaIssue {
	path: string;
	message: string;
}

export class SchemaError extends Error {
	readonly issue: SchemaIssue;

	constructor(issue: SchemaIssue) {
		super(`${issue.path}: ${issue.message}`);
		this.name = "SchemaError";
		this.issue = issue;
	}
}

export type Validated<T> = { ok: true; value: T } | { ok: false; issue: SchemaIssue };

const ID_PATTERN = /^[a-z]_[a-z0-9]{6,32}$/;
const SOURCE_ID_PATTERN = /^s[0-9]{1,3}$/;

function fail(path: string, message: string): never {
	throw new SchemaError({ path, message });
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(path, "must be an object");
	}
	for (const key of Object.keys(value)) {
		if (!keys.includes(key)) fail(`${path}.${key}`, "is not a known field");
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) fail(path, "must be an array");
	return value;
}

/** Counts user-perceived characters roughly, so limits do not penalize non-Latin scripts. */
export function textLength(value: string): number {
	return Array.from(value).length;
}

function text(value: unknown, path: string, maximum: number, optional = false): string {
	if (value === undefined && optional) return "";
	if (typeof value !== "string") fail(path, "must be a string");
	if (value.trim() === "") fail(path, "must not be empty");
	if (textLength(value) > maximum) {
		fail(path, `is ${textLength(value)} characters, the limit is ${maximum}`);
	}
	return value;
}

function id(value: unknown, path: string, seen: Set<string>): string {
	if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(path, "is not a valid ID");
	if (seen.has(value)) fail(path, `duplicates ID ${value}`);
	seen.add(value);
	return value;
}

export function plainText(value: RichText): string {
	return value.map((run) => run.text).join("");
}

function richText(value: unknown, path: string, maximum: number): RichText {
	const runs = array(value, path);
	if (runs.length === 0) fail(path, "must not be empty");
	const result: TextRun[] = runs.map((raw, index) => {
		const runPath = `${path}[${index}]`;
		const run = record(raw, runPath, ["text", "bold", "italic"]);
		if (typeof run["text"] !== "string" || run["text"] === "") {
			fail(`${runPath}.text`, "must be a non-empty string");
		}
		const next: TextRun = { text: run["text"] };
		for (const mark of ["bold", "italic"] as const) {
			if (run[mark] === undefined) continue;
			if (run[mark] !== true) fail(`${runPath}.${mark}`, "must be true when present");
			next[mark] = true;
		}
		return next;
	});
	const plain = plainText(result);
	if (plain.trim() === "") fail(path, "must not be blank");
	if (textLength(plain) > maximum) {
		fail(path, `is ${textLength(plain)} characters, the limit is ${maximum}`);
	}
	return result;
}

function listItems(value: unknown, path: string, seen: Set<string>): ListItem[] {
	return array(value, path).map((raw, index) => {
		const itemPath = `${path}[${index}]`;
		const item = record(raw, itemPath, ["id", "text"]);
		return {
			id: id(item["id"], `${itemPath}.id`, seen),
			text: richText(item["text"], `${itemPath}.text`, LIMITS.listItem),
		};
	});
}

const ASSET_ID_PATTERN = /^[0-9a-f]{64}$/;

function fraction(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		fail(path, "must be a number from 0 to 1");
	}
	return value;
}

function count(length: number, path: string, bounds: { min: number; max: number }, noun: string) {
	if (length < bounds.min || length > bounds.max) {
		fail(path, `must hold ${bounds.min}-${bounds.max} ${noun}, got ${length}`);
	}
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a number");
	if (value < minimum || value > maximum) fail(path, `must be from ${minimum} to ${maximum}`);
	return value;
}

function chart(value: unknown, path: string, seen: Set<string>): ChartNode {
	const raw = record(value, path, [
		"id",
		"type",
		"kind",
		"size",
		"categories",
		"series",
		"prefix",
		"suffix",
		"caption",
	]);
	const nodeID = id(raw["id"], `${path}.id`, seen);
	const categories = array(raw["categories"], `${path}.categories`).map((category, index) =>
		text(category, `${path}.categories[${index}]`, LIMITS.categoryLabel),
	);
	count(categories.length, `${path}.categories`, LIMITS.chartCategories, "categories");
	if (new Set(categories).size !== categories.length) fail(`${path}.categories`, "must not repeat");
	const seriesList = array(raw["series"], `${path}.series`);
	count(seriesList.length, `${path}.series`, LIMITS.chartSeries, "series");
	const series = seriesList.map((rawSeries, index) => {
		const seriesPath = `${path}.series[${index}]`;
		const entry = record(rawSeries, seriesPath, ["id", "name", "values"]);
		const values = array(entry["values"], `${seriesPath}.values`).map((number, valueIndex) =>
			finite(number, `${seriesPath}.values[${valueIndex}]`, -LIMITS.chartValue, LIMITS.chartValue),
		);
		if (values.length !== categories.length) {
			fail(`${seriesPath}.values`, `must hold one value per category, ${categories.length} in all`);
		}
		return {
			id: id(entry["id"], `${seriesPath}.id`, seen),
			name: text(entry["name"], `${seriesPath}.name`, LIMITS.seriesName),
			values,
		};
	});
	const result: ChartNode = {
		id: nodeID,
		type: "chart",
		kind: oneOf(raw["kind"], `${path}.kind`, CHART_KINDS),
		size: oneOf(raw["size"], `${path}.size`, WIDGET_SIZES),
		categories,
		series,
	};
	for (const field of ["prefix", "suffix"] as const) {
		if (raw[field] !== undefined)
			result[field] = text(raw[field], `${path}.${field}`, LIMITS.affix);
	}
	if (raw["caption"] !== undefined) {
		result.caption = text(raw["caption"], `${path}.caption`, LIMITS.chartCaption);
	}
	const mismatch = chartKindMismatch(result.kind, result);
	if (mismatch) fail(`${path}.kind`, mismatch);
	return result;
}

function node(
	value: unknown,
	path: string,
	seen: Set<string>,
	knownAssets?: ReadonlySet<string>,
): ContentNode {
	const type = (value as { type?: unknown } | null)?.type;
	switch (type) {
		case "heading":
		case "paragraph": {
			const raw = record(value, path, ["id", "type", "text"]);
			const limit = type === "heading" ? LIMITS.heading : LIMITS.paragraph;
			return {
				id: id(raw["id"], `${path}.id`, seen),
				type,
				text: richText(raw["text"], `${path}.text`, limit),
			};
		}
		case "bullets": {
			const raw = record(value, path, ["id", "type", "items"]);
			return {
				id: id(raw["id"], `${path}.id`, seen),
				type,
				items: listItems(raw["items"], `${path}.items`, seen),
			};
		}
		case "quote": {
			const raw = record(value, path, ["id", "type", "text", "attribution"]);
			const result: ContentNode = {
				id: id(raw["id"], `${path}.id`, seen),
				type,
				text: richText(raw["text"], `${path}.text`, LIMITS.quote),
			};
			if (raw["attribution"] !== undefined) {
				result.attribution = text(raw["attribution"], `${path}.attribution`, LIMITS.attribution);
			}
			return result;
		}
		case "stat": {
			const raw = record(value, path, ["id", "type", "value", "label"]);
			return {
				id: id(raw["id"], `${path}.id`, seen),
				type,
				value: text(raw["value"], `${path}.value`, LIMITS.statValue),
				label: text(raw["label"], `${path}.label`, LIMITS.statLabel),
			};
		}
		case "steps": {
			const raw = record(value, path, ["id", "type", "items"]);
			const nodeID = id(raw["id"], `${path}.id`, seen);
			const items: Step[] = array(raw["items"], `${path}.items`).map((rawStep, index) => {
				const stepPath = `${path}.items[${index}]`;
				const step = record(rawStep, stepPath, ["id", "title", "detail"]);
				const result: Step = {
					id: id(step["id"], `${stepPath}.id`, seen),
					title: text(step["title"], `${stepPath}.title`, LIMITS.stepTitle),
				};
				if (step["detail"] !== undefined) {
					result.detail = richText(step["detail"], `${stepPath}.detail`, LIMITS.stepDetail);
				}
				return result;
			});
			return { id: nodeID, type, items };
		}
		case "columns": {
			const raw = record(value, path, ["id", "type", "columns"]);
			const nodeID = id(raw["id"], `${path}.id`, seen);
			const columns: Column[] = array(raw["columns"], `${path}.columns`).map((rawColumn, index) => {
				const columnPath = `${path}.columns[${index}]`;
				const column = record(rawColumn, columnPath, ["id", "heading", "items"]);
				return {
					id: id(column["id"], `${columnPath}.id`, seen),
					heading: text(column["heading"], `${columnPath}.heading`, LIMITS.columnHeading),
					items: listItems(column["items"], `${columnPath}.items`, seen),
				};
			});
			return { id: nodeID, type, columns };
		}
		case "image": {
			const raw = record(value, path, ["id", "type", "assetId", "alt", "fit", "focus"]);
			const assetId = raw["assetId"];
			if (typeof assetId !== "string" || !ASSET_ID_PATTERN.test(assetId)) {
				fail(`${path}.assetId`, "is not an asset ID");
			}
			if (knownAssets && !knownAssets.has(assetId)) {
				fail(`${path}.assetId`, `names an asset this presentation does not have`);
			}
			const result: ContentNode = {
				id: id(raw["id"], `${path}.id`, seen),
				type,
				assetId,
				alt: text(raw["alt"], `${path}.alt`, LIMITS.imageAlt),
				fit: oneOf(raw["fit"], `${path}.fit`, ["cover", "contain"] as const),
			};
			if (raw["focus"] !== undefined) {
				const focus = record(raw["focus"], `${path}.focus`, ["x", "y"]);
				result.focus = {
					x: fraction(focus["x"], `${path}.focus.x`),
					y: fraction(focus["y"], `${path}.focus.y`),
				};
			}
			return result;
		}
		case "chart":
			return chart(value, path, seen);
		case "progress": {
			const raw = record(value, path, ["id", "type", "size", "items"]);
			const nodeID = id(raw["id"], `${path}.id`, seen);
			const items = array(raw["items"], `${path}.items`).map((rawMeter, index) => {
				const meterPath = `${path}.items[${index}]`;
				const meter = record(rawMeter, meterPath, ["id", "label", "value"]);
				return {
					id: id(meter["id"], `${meterPath}.id`, seen),
					label: text(meter["label"], `${meterPath}.label`, LIMITS.meterLabel),
					value: finite(meter["value"], `${meterPath}.value`, 0, 100),
				};
			});
			count(items.length, `${path}.items`, LIMITS.meters, "meters");
			return { id: nodeID, type, size: oneOf(raw["size"], `${path}.size`, WIDGET_SIZES), items };
		}
		case "table": {
			const raw = record(value, path, ["id", "type", "size", "columns", "rows"]);
			const nodeID = id(raw["id"], `${path}.id`, seen);
			const columns = array(raw["columns"], `${path}.columns`).map((heading, index) =>
				text(heading, `${path}.columns[${index}]`, LIMITS.tableHeading),
			);
			count(columns.length, `${path}.columns`, LIMITS.tableColumns, "columns");
			const rows = array(raw["rows"], `${path}.rows`).map((rawRow, index) => {
				const rowPath = `${path}.rows[${index}]`;
				const row = record(rawRow, rowPath, ["id", "cells"]);
				const cells = array(row["cells"], `${rowPath}.cells`).map((cell, cellIndex) => {
					// An empty cell is allowed; a table may leave a value blank.
					if (cell === "") return "";
					return text(cell, `${rowPath}.cells[${cellIndex}]`, LIMITS.tableCell);
				});
				if (cells.length !== columns.length) {
					fail(`${rowPath}.cells`, `must hold one cell per column, ${columns.length} in all`);
				}
				return { id: id(row["id"], `${rowPath}.id`, seen), cells };
			});
			count(rows.length, `${path}.rows`, LIMITS.tableRows, "rows");
			return {
				id: nodeID,
				type,
				size: oneOf(raw["size"], `${path}.size`, WIDGET_SIZES),
				columns,
				rows,
			};
		}
		case "callout": {
			const raw = record(value, path, ["id", "type", "size", "tone", "text"]);
			return {
				id: id(raw["id"], `${path}.id`, seen),
				type,
				size: oneOf(raw["size"], `${path}.size`, WIDGET_SIZES),
				tone: oneOf(raw["tone"], `${path}.tone`, CALLOUT_TONES),
				text: richText(raw["text"], `${path}.text`, LIMITS.callout),
			};
		}
		default:
			fail(`${path}.type`, `unsupported node type ${JSON.stringify(type)}`);
	}
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		fail(path, `must be one of ${allowed.join(", ")}`);
	}
	return value as T;
}

function sourceIds(value: unknown, path: string, known?: ReadonlySet<string>): string[] {
	const ids = array(value, path);
	if (ids.length > LIMITS.sourceIds) fail(path, `may name at most ${LIMITS.sourceIds} sources`);
	const unique = new Set<string>();
	for (const [index, raw] of ids.entries()) {
		if (typeof raw !== "string" || !SOURCE_ID_PATTERN.test(raw)) {
			fail(`${path}[${index}]`, "is not a source ID");
		}
		if (known && !known.has(raw)) fail(`${path}[${index}]`, `names unknown source ${raw}`);
		unique.add(raw);
	}
	return [...unique];
}

export interface CardContext {
	/** Every ID already used in the document. The card's IDs are added to it. */
	seen: Set<string>;
	/** Asset IDs the card may show. Absent means any well-formed ID is accepted. */
	knownAssets?: ReadonlySet<string>;
	/** Source IDs the card may cite. Absent means any well-formed ID is accepted. */
	knownSources?: ReadonlySet<string>;
}

export function parseCard(value: unknown, path: string, context: CardContext): Card {
	const raw = record(value, path, [
		"id",
		"takeaway",
		"role",
		"layout",
		"nodes",
		"sourceIds",
		"notes",
	]);
	const card: Card = {
		id: id(raw["id"], `${path}.id`, context.seen),
		takeaway: text(raw["takeaway"], `${path}.takeaway`, LIMITS.takeaway),
		role: oneOf(raw["role"], `${path}.role`, NARRATIVE_ROLES),
		layout: oneOf(raw["layout"], `${path}.layout`, LAYOUTS),
		nodes: array(raw["nodes"], `${path}.nodes`).map((rawNode, index) =>
			node(rawNode, `${path}.nodes[${index}]`, context.seen, context.knownAssets),
		),
		sourceIds: sourceIds(raw["sourceIds"], `${path}.sourceIds`, context.knownSources),
	};
	if (raw["notes"] !== undefined) card.notes = text(raw["notes"], `${path}.notes`, LIMITS.notes);
	const mismatch = layoutMismatch(card.layout, card.nodes);
	if (mismatch) fail(`${path}.layout`, mismatch);
	return card;
}

export interface DocumentOptions {
	/** Asset IDs the document may show. Absent means any well-formed ID is accepted. */
	knownAssets?: ReadonlySet<string>;
}

/**
 * Checks an unknown value against the card document schema and returns it as
 * the current version. Earlier documents are upgraded on read: versions 2 and
 * 3 only added node types and layouts, so older content is already valid.
 * Stored bytes are never rewritten; the next save writes the current version.
 */
export function parseCardDocument(value: unknown, options: DocumentOptions = {}): CardDocument {
	const raw = record(value, "document", ["schemaVersion", "title", "theme", "cardOrder", "cards"]);
	const version = raw["schemaVersion"];
	if (!READABLE_SCHEMA_VERSIONS.includes(version as (typeof READABLE_SCHEMA_VERSIONS)[number])) {
		fail("document.schemaVersion", `must be one of ${READABLE_SCHEMA_VERSIONS.join(", ")}`);
	}
	const order = array(raw["cardOrder"], "document.cardOrder");
	if (order.length < LIMITS.cards.min || order.length > LIMITS.cards.max) {
		fail("document.cardOrder", `must hold ${LIMITS.cards.min}-${LIMITS.cards.max} cards`);
	}
	const cardsRaw = record(raw["cards"], "document.cards", order.map(String));
	const context: CardContext = { seen: new Set(), knownAssets: options.knownAssets };
	const cards: Record<string, Card> = {};
	const cardOrder: string[] = [];
	for (const [index, cardID] of order.entries()) {
		if (typeof cardID !== "string") fail(`document.cardOrder[${index}]`, "must be a string");
		if (cards[cardID]) fail(`document.cardOrder[${index}]`, `repeats card ${cardID}`);
		const card = parseCard(cardsRaw[cardID], `document.cards.${cardID}`, context);
		if (card.id !== cardID) fail(`document.cards.${cardID}.id`, "does not match its key");
		cards[cardID] = card;
		cardOrder.push(cardID);
	}
	return {
		schemaVersion: CARD_SCHEMA_VERSION,
		title: text(raw["title"], "document.title", LIMITS.title),
		theme: oneOf(raw["theme"], "document.theme", THEMES),
		cardOrder,
		cards,
	};
}

export function validateCardDocument(
	value: unknown,
	options: DocumentOptions = {},
): Validated<CardDocument> {
	try {
		return { ok: true, value: parseCardDocument(value, options) };
	} catch (error) {
		if (error instanceof SchemaError) return { ok: false, issue: error.issue };
		throw error;
	}
}
