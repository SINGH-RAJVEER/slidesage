import { layoutMismatch } from "./layouts";
import {
	CARD_SCHEMA_VERSION,
	type Card,
	type CardDocument,
	type Column,
	type ContentNode,
	LAYOUTS,
	LIMITS,
	type ListItem,
	NARRATIVE_ROLES,
	type RichText,
	type Step,
	type TextRun,
	THEMES,
} from "./schema";

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

function node(value: unknown, path: string, seen: Set<string>): ContentNode {
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
			node(rawNode, `${path}.nodes[${index}]`, context.seen),
		),
		sourceIds: sourceIds(raw["sourceIds"], `${path}.sourceIds`, context.knownSources),
	};
	if (raw["notes"] !== undefined) card.notes = text(raw["notes"], `${path}.notes`, LIMITS.notes);
	const mismatch = layoutMismatch(card.layout, card.nodes);
	if (mismatch) fail(`${path}.layout`, mismatch);
	return card;
}

/** Checks an unknown value against the version 1 card document schema. */
export function parseCardDocument(value: unknown): CardDocument {
	const raw = record(value, "document", ["schemaVersion", "title", "theme", "cardOrder", "cards"]);
	if (raw["schemaVersion"] !== CARD_SCHEMA_VERSION) {
		fail("document.schemaVersion", `must be ${CARD_SCHEMA_VERSION}`);
	}
	const order = array(raw["cardOrder"], "document.cardOrder");
	if (order.length < LIMITS.cards.min || order.length > LIMITS.cards.max) {
		fail("document.cardOrder", `must hold ${LIMITS.cards.min}-${LIMITS.cards.max} cards`);
	}
	const cardsRaw = record(raw["cards"], "document.cards", order.map(String));
	const context: CardContext = { seen: new Set() };
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

export function validateCardDocument(value: unknown): Validated<CardDocument> {
	try {
		return { ok: true, value: parseCardDocument(value) };
	} catch (error) {
		if (error instanceof SchemaError) return { ok: false, issue: error.issue };
		throw error;
	}
}
