import {
	assembleDocument,
	CARD_SCHEMA_VERSION,
	type Card,
	type CardDraftInput,
	convertCards,
	draftingSchema,
	NARRATIVE_ROLES,
	type NarrativeRole,
	parseCardDocument,
	SchemaError,
	THEMES,
	type ThemeId,
} from "@slidesage/cards";

/** Requests larger than this are refused before parsing. */
export const MAX_BODY_BYTES = 1024 * 1024;

export const SCHEMA_VERSION_HEADER = "X-Card-Schema-Version";

class RequestError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function json(status: number, body: unknown): Response {
	return Response.json(body, { status });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_BODY_BYTES) throw new RequestError(413, "request body is too large");
	const raw = await request.text();
	if (raw.length > MAX_BODY_BYTES) throw new RequestError(413, "request body is too large");
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		throw new RequestError(400, "request body is not JSON");
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new RequestError(400, "request body must be an object");
	}
	return body as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new RequestError(400, `${field} must be a non-empty string`);
	}
	return value;
}

function requireArray(value: unknown, field: string): unknown[] {
	if (!Array.isArray(value)) throw new RequestError(400, `${field} must be an array`);
	return value;
}

function stringList(value: unknown, field: string): string[] {
	return requireArray(value ?? [], field).map((item, index) =>
		requireString(item, `${field}[${index}]`),
	);
}

function draftInputs(value: unknown): CardDraftInput[] {
	return requireArray(value, "cards").map((raw, index) => {
		if (typeof raw !== "object" || raw === null) {
			throw new RequestError(400, `cards[${index}] must be an object`);
		}
		const entry = raw as Record<string, unknown>;
		const position = entry["position"];
		if (typeof position !== "number" || !Number.isInteger(position) || position < 1) {
			throw new RequestError(400, `cards[${index}].position must be a positive integer`);
		}
		const role = entry["role"];
		if (!NARRATIVE_ROLES.includes(role as NarrativeRole)) {
			throw new RequestError(400, `cards[${index}].role is not a narrative role`);
		}
		return {
			position,
			takeaway: requireString(entry["takeaway"], `cards[${index}].takeaway`),
			role: role as NarrativeRole,
			draft: entry["draft"],
		};
	});
}

async function convert(request: Request): Promise<Response> {
	const body = await readBody(request);
	const results = convertCards({
		operationId: requireString(body["operationId"], "operationId"),
		sourceIds: requireArray(body["sourceIds"] ?? [], "sourceIds").map((id, index) =>
			requireString(id, `sourceIds[${index}]`),
		),
		assetIds: stringList(body["assetIds"], "assetIds"),
		cards: draftInputs(body["cards"]),
	});
	return json(200, { schemaVersion: CARD_SCHEMA_VERSION, results });
}

async function assemble(request: Request): Promise<Response> {
	const body = await readBody(request);
	const theme = body["theme"];
	if (!THEMES.includes(theme as ThemeId)) throw new RequestError(400, "theme is not known");
	try {
		const document = assembleDocument({
			title: requireString(body["title"], "title"),
			theme: theme as ThemeId,
			cards: requireArray(body["cards"], "cards") as Card[],
			assetIds: stringList(body["assetIds"], "assetIds"),
		});
		return json(200, { schemaVersion: CARD_SCHEMA_VERSION, document });
	} catch (error) {
		if (error instanceof SchemaError) {
			return json(422, { schemaVersion: CARD_SCHEMA_VERSION, issue: error.issue });
		}
		throw error;
	}
}

/**
 * Validates a whole edited document and returns it normalized to the current
 * schema version. Only assets the caller lists may be shown.
 */
async function validateDocument(request: Request): Promise<Response> {
	const body = await readBody(request);
	try {
		const document = parseCardDocument(body["document"], {
			knownAssets: new Set(stringList(body["assetIds"], "assetIds")),
		});
		return json(200, { schemaVersion: CARD_SCHEMA_VERSION, document });
	} catch (error) {
		if (error instanceof SchemaError) {
			return json(422, { schemaVersion: CARD_SCHEMA_VERSION, issue: error.issue });
		}
		throw error;
	}
}

/**
 * Routes one request. Every conversion request names the schema version its
 * caller was built against; a mismatch is refused rather than converted into
 * a document the caller cannot read.
 */
export async function handle(request: Request): Promise<Response> {
	const url = new URL(request.url);
	try {
		if (request.method === "GET" && url.pathname === "/health") {
			return json(200, { status: "ok", schemaVersion: CARD_SCHEMA_VERSION });
		}
		if (request.method === "GET" && url.pathname === "/v1/schema") {
			return json(200, draftingSchema());
		}
		if (request.method !== "POST") return json(404, { error: "not found" });
		const routes: Record<string, (request: Request) => Promise<Response>> = {
			"/v1/cards": convert,
			"/v1/documents": assemble,
			"/v1/documents/validate": validateDocument,
		};
		const route = routes[url.pathname];
		if (!route) return json(404, { error: "not found" });
		const version = request.headers.get(SCHEMA_VERSION_HEADER);
		if (version !== String(CARD_SCHEMA_VERSION)) {
			return json(409, {
				error: `schema version ${version ?? "(missing)"} is not served; this converter serves ${CARD_SCHEMA_VERSION}`,
			});
		}
		return await route(request);
	} catch (error) {
		if (error instanceof RequestError) return json(error.status, { error: error.message });
		console.error("card conversion failed", error);
		return json(500, { error: "conversion failed" });
	}
}
