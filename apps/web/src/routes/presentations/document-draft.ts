import { type CardDocument, LAYOUTS, NARRATIVE_ROLES, THEMES } from "@slidesage/cards";
import { isRecord } from "../../hooks/usePageDraft";

export interface DraftOperation {
	document: CardDocument;
	validated: CardDocument;
	id: string;
}

export interface DocumentDraft {
	owner: string;
	document: CardDocument;
	savedDocument: CardDocument;
	baseRevision: number;
	pendingOperation: DraftOperation | null;
}

const strings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");
const numbers = (value: unknown): value is number[] =>
	Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
const richText = (value: unknown): boolean =>
	Array.isArray(value) && value.every((run) => isRecord(run) && typeof run["text"] === "string");
const listItems = (value: unknown): boolean =>
	Array.isArray(value) &&
	value.every((item) => isRecord(item) && typeof item["id"] === "string" && richText(item["text"]));

function isNode(value: unknown): boolean {
	if (!isRecord(value) || typeof value["id"] !== "string") return false;
	switch (value["type"]) {
		case "heading":
		case "paragraph":
		case "quote":
		case "callout":
			return richText(value["text"]);
		case "bullets":
			return listItems(value["items"]);
		case "stat":
			return typeof value["value"] === "string" && typeof value["label"] === "string";
		case "steps":
			return (
				Array.isArray(value["items"]) &&
				value["items"].every(
					(step) =>
						isRecord(step) &&
						typeof step["id"] === "string" &&
						typeof step["title"] === "string" &&
						(step["detail"] === undefined || richText(step["detail"])),
				)
			);
		case "columns":
			return (
				Array.isArray(value["columns"]) &&
				value["columns"].every(
					(column) =>
						isRecord(column) &&
						typeof column["id"] === "string" &&
						typeof column["heading"] === "string" &&
						listItems(column["items"]),
				)
			);
		case "image":
			return (
				typeof value["assetId"] === "string" &&
				typeof value["alt"] === "string" &&
				(value["fit"] === "cover" || value["fit"] === "contain")
			);
		case "chart":
			return (
				typeof value["kind"] === "string" &&
				strings(value["categories"]) &&
				Array.isArray(value["series"]) &&
				value["series"].every(
					(series) =>
						isRecord(series) &&
						typeof series["id"] === "string" &&
						typeof series["name"] === "string" &&
						numbers(series["values"]),
				)
			);
		case "progress":
			return (
				Array.isArray(value["items"]) &&
				value["items"].every(
					(meter) =>
						isRecord(meter) &&
						typeof meter["id"] === "string" &&
						typeof meter["label"] === "string" &&
						typeof meter["value"] === "number",
				)
			);
		case "table":
			return (
				strings(value["columns"]) &&
				Array.isArray(value["rows"]) &&
				value["rows"].every(
					(row) => isRecord(row) && typeof row["id"] === "string" && strings(row["cells"]),
				)
			);
		default:
			return false;
	}
}

// Drafts can contain blank text or other incomplete edits that the save schema
// refuses. Check their structure here; normal validation still gates every save.
function isDocument(value: unknown): value is CardDocument {
	return (
		isRecord(value) &&
		value["schemaVersion"] === 3 &&
		typeof value["title"] === "string" &&
		typeof value["theme"] === "string" &&
		(THEMES as readonly string[]).includes(value["theme"]) &&
		Array.isArray(value["cardOrder"]) &&
		isRecord(value["cards"]) &&
		value["cardOrder"].every(
			(id) =>
				typeof id === "string" &&
				isRecord(value["cards"]) &&
				isRecord(value["cards"][id]) &&
				typeof value["cards"][id]["id"] === "string" &&
				typeof value["cards"][id]["takeaway"] === "string" &&
				typeof value["cards"][id]["layout"] === "string" &&
				(LAYOUTS as readonly string[]).includes(value["cards"][id]["layout"] as string) &&
				typeof value["cards"][id]["role"] === "string" &&
				(NARRATIVE_ROLES as readonly string[]).includes(value["cards"][id]["role"] as string) &&
				Array.isArray(value["cards"][id]["nodes"]) &&
				(value["cards"][id]["nodes"] as unknown[]).every(isNode) &&
				strings(value["cards"][id]["sourceIds"]),
		)
	);
}

export function isDocumentDraft(value: unknown): value is DocumentDraft {
	return (
		isRecord(value) &&
		typeof value["owner"] === "string" &&
		typeof value["baseRevision"] === "number" &&
		Number.isInteger(value["baseRevision"]) &&
		isDocument(value["document"]) &&
		isDocument(value["savedDocument"]) &&
		(value["pendingOperation"] === null ||
			(isRecord(value["pendingOperation"]) &&
				typeof value["pendingOperation"]["id"] === "string" &&
				isDocument(value["pendingOperation"]["document"]) &&
				isDocument(value["pendingOperation"]["validated"])))
	);
}

/** JSONB reads may order object keys differently from the browser's draft. */
export function sameDocument(left: CardDocument, right: CardDocument): boolean {
	const serialize = (value: CardDocument) =>
		JSON.stringify(value, (_key, entry) =>
			isRecord(entry)
				? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
				: entry,
		);
	return serialize(left) === serialize(right);
}
