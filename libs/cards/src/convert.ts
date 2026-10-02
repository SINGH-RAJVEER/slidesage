import {
	CARD_SCHEMA_VERSION,
	type Card,
	type CardDocument,
	type NarrativeRole,
	type RichText,
	type TextRun,
	type ThemeId,
} from "./schema";
import { parseCard, parseCardDocument, SchemaError, type SchemaIssue } from "./validate";

/**
 * Model output for one card. It carries content only: no IDs, styling, or
 * markup beyond `**bold**` and `*italic*` inside text.
 */
export interface CardDraftInput {
	position: number;
	takeaway: string;
	role: NarrativeRole;
	draft: unknown;
}

export interface ConvertCardsRequest {
	operationId: string;
	/** Research source IDs the cards may cite. */
	sourceIds: string[];
	/** Stored image assets the cards may show. */
	assetIds?: string[];
	cards: CardDraftInput[];
}

export type CardResult =
	| { position: number; card: Card }
	| { position: number; issue: SchemaIssue };

/**
 * cyrb53: a small, fast, well-distributed 53-bit string hash. IDs derived from
 * it only need to be unique within one document, and deriving them from the
 * operation and position makes a retried conversion produce identical IDs.
 */
function hash(value: string): string {
	let first = 0xdeadbeef;
	let second = 0x41c6ce57;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		first = Math.imul(first ^ code, 2654435761);
		second = Math.imul(second ^ code, 1597334677);
	}
	first =
		Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
	second =
		Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
	return (4294967296 * (2097151 & second) + (first >>> 0)).toString(36).padStart(8, "0");
}

// C0/C1 controls, zero-width characters, and bidirectional overrides can hide
// or reorder text, so none survive conversion.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
// Only HTML tags a model might emit are stripped, and only with name="value"
// attributes, so comparisons such as "a<b and c>d" stay as text. Text is
// always escaped when rendered; the stripping keeps stray markup out of view.
const MARKUP_TAG =
	/<\/?(?:a|b|big|blockquote|br|code|del|div|em|embed|font|h[1-6]|hr|i|iframe|img|ins|li|mark|object|ol|p|pre|s|script|small|span|strike|strong|style|sub|sup|svg|table|tbody|td|th|thead|tr|u|ul)(?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))*\s*\/?>/gi;

/** Normalizes model text: no tags, no control characters, single spaces. */
export function cleanText(value: string): string {
	return value
		.normalize("NFC")
		.replace(MARKUP_TAG, "")
		.replace(UNSAFE_CHARACTERS, " ")
		.replace(/\s+/g, " ")
		.trim();
}

const EMPHASIS = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;

/** Parses `**bold**` and `*italic*` into runs; any other asterisk stays literal. */
export function parseInlineMarkup(value: string): RichText {
	const cleaned = cleanText(value);
	const runs: TextRun[] = [];
	for (const part of cleaned.split(EMPHASIS)) {
		if (part === "") continue;
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			runs.push({ text: part.slice(2, -2), bold: true });
		} else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
			runs.push({ text: part.slice(1, -1), italic: true });
		} else {
			runs.push({ text: part });
		}
	}
	return runs;
}

class DraftReader {
	private counter = 0;
	private readonly operationId: string;
	private readonly position: number;

	constructor(operationId: string, position: number) {
		this.operationId = operationId;
		this.position = position;
	}

	nextID(prefix: string): string {
		this.counter += 1;
		return `${prefix}_${hash(`${this.operationId}:${this.position}:${this.counter}`)}`;
	}

	object(value: unknown, path: string): Record<string, unknown> {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new SchemaError({ path, message: "must be an object" });
		}
		return value as Record<string, unknown>;
	}

	list(value: unknown, path: string): unknown[] {
		if (!Array.isArray(value)) throw new SchemaError({ path, message: "must be an array" });
		return value;
	}

	string(value: unknown, path: string): string {
		if (typeof value !== "string") throw new SchemaError({ path, message: "must be a string" });
		return cleanText(value);
	}

	rich(value: unknown, path: string): RichText {
		if (typeof value !== "string") throw new SchemaError({ path, message: "must be a string" });
		return parseInlineMarkup(value);
	}

	items(value: unknown, path: string) {
		return this.list(value, path).map((item, index) => ({
			id: this.nextID("i"),
			text: this.rich(item, `${path}[${index}]`),
		}));
	}

	node(value: unknown, path: string): unknown {
		const raw = this.object(value, path);
		const type = raw["type"];
		switch (type) {
			case "heading":
			case "paragraph":
				return { id: this.nextID("n"), type, text: this.rich(raw["text"], `${path}.text`) };
			case "bullets":
				return { id: this.nextID("n"), type, items: this.items(raw["items"], `${path}.items`) };
			case "quote": {
				const node: Record<string, unknown> = {
					id: this.nextID("n"),
					type,
					text: this.rich(raw["text"], `${path}.text`),
				};
				if (typeof raw["attribution"] === "string" && cleanText(raw["attribution"]) !== "") {
					node["attribution"] = cleanText(raw["attribution"]);
				}
				return node;
			}
			case "stat":
				return {
					id: this.nextID("n"),
					type,
					value: this.string(raw["value"], `${path}.value`),
					label: this.string(raw["label"], `${path}.label`),
				};
			case "steps": {
				const id = this.nextID("n");
				const items = this.list(raw["items"], `${path}.items`).map((rawStep, index) => {
					const stepPath = `${path}.items[${index}]`;
					const step = this.object(rawStep, stepPath);
					const result: Record<string, unknown> = {
						id: this.nextID("i"),
						title: this.string(step["title"], `${stepPath}.title`),
					};
					if (typeof step["detail"] === "string" && cleanText(step["detail"]) !== "") {
						result["detail"] = this.rich(step["detail"], `${stepPath}.detail`);
					}
					return result;
				});
				return { id, type, items };
			}
			case "columns": {
				const id = this.nextID("n");
				const columns = this.list(raw["columns"], `${path}.columns`).map((rawColumn, index) => {
					const columnPath = `${path}.columns[${index}]`;
					const column = this.object(rawColumn, columnPath);
					return {
						id: this.nextID("i"),
						heading: this.string(column["heading"], `${columnPath}.heading`),
						items: this.items(column["items"], `${columnPath}.items`),
					};
				});
				return { id, type, columns };
			}
			case "image": {
				// Image nodes are placed by the drafter, not the model, so the asset
				// ID is taken verbatim and checked against the known assets on parse.
				const node: Record<string, unknown> = {
					id: this.nextID("n"),
					type,
					assetId: raw["assetId"],
					alt: typeof raw["alt"] === "string" ? cleanText(raw["alt"]) : raw["alt"],
					fit: raw["fit"] ?? "cover",
				};
				if (raw["focus"] !== undefined) node["focus"] = raw["focus"];
				return node;
			}
			default:
				throw new SchemaError({
					path: `${path}.type`,
					message: `unsupported node type ${JSON.stringify(type)}; use heading, paragraph, bullets, quote, stat, steps, or columns`,
				});
		}
	}
}

function convertOne(
	input: CardDraftInput,
	operationId: string,
	knownSources: ReadonlySet<string>,
	knownAssets: ReadonlySet<string>,
): Card {
	const reader = new DraftReader(operationId, input.position);
	const draft = reader.object(input.draft, "card");
	const candidate: Record<string, unknown> = {
		id: `c_${hash(`${operationId}:card:${input.position}`)}`,
		takeaway: cleanText(input.takeaway),
		role: input.role,
		layout: draft["layout"],
		nodes: reader
			.list(draft["nodes"], "card.nodes")
			.map((node, index) => reader.node(node, `card.nodes[${index}]`)),
		sourceIds: Array.isArray(draft["sourceIds"]) ? draft["sourceIds"] : [],
	};
	if (typeof draft["notes"] === "string" && cleanText(draft["notes"]) !== "") {
		candidate["notes"] = cleanText(draft["notes"]);
	}
	return parseCard(candidate, "card", { seen: new Set(), knownSources, knownAssets });
}

/**
 * Converts drafted cards independently, so one invalid card is reported for a
 * targeted repair without discarding the rest of the batch.
 */
export function convertCards(request: ConvertCardsRequest): CardResult[] {
	const knownSources = new Set(request.sourceIds);
	const knownAssets = new Set(request.assetIds ?? []);
	return request.cards.map((input) => {
		try {
			return {
				position: input.position,
				card: convertOne(input, request.operationId, knownSources, knownAssets),
			};
		} catch (error) {
			if (error instanceof SchemaError) return { position: input.position, issue: error.issue };
			throw error;
		}
	});
}

export interface AssembleDocumentRequest {
	title: string;
	theme: ThemeId;
	cards: Card[];
	/** Stored image assets the document may show. */
	assetIds?: string[];
}

/** Assembles converted cards in order and validates the whole document. */
export function assembleDocument(request: AssembleDocumentRequest): CardDocument {
	return parseCardDocument(
		{
			schemaVersion: CARD_SCHEMA_VERSION,
			title: cleanText(request.title),
			theme: request.theme,
			cardOrder: request.cards.map((card) => card.id),
			cards: Object.fromEntries(request.cards.map((card) => [card.id, card])),
		},
		{ knownAssets: new Set(request.assetIds ?? []) },
	);
}
