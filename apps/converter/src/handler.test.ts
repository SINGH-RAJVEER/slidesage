import { describe, expect, it } from "bun:test";
import { handle, SCHEMA_VERSION_HEADER } from "./handler";

function post(path: string, body: unknown, version = "2") {
	return handle(
		new Request(`http://converter${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", [SCHEMA_VERSION_HEADER]: version },
			body: JSON.stringify(body),
		}),
	);
}

const draft = {
	layout: "title",
	nodes: [{ type: "heading", text: "Grid storage" }],
};

describe("converter", () => {
	it("reports health with its schema version", async () => {
		const response = await handle(new Request("http://converter/health"));
		expect(await response.json()).toEqual({ status: "ok", schemaVersion: 2 });
	});

	it("serves the drafting schema its caller builds prompts from", async () => {
		const response = await handle(new Request("http://converter/v1/schema"));
		const body = (await response.json()) as { schemaVersion: number; layouts: object };
		expect(body.schemaVersion).toBe(2);
		expect(Object.keys(body.layouts)).toContain("comparison");
	});

	it("refuses a caller built against another schema version", async () => {
		const response = await post("/v1/cards", {}, "1");
		expect(response.status).toBe(409);
	});

	it("converts cards and reports invalid ones per position", async () => {
		const response = await post("/v1/cards", {
			operationId: "op-1",
			sourceIds: [],
			cards: [
				{ position: 1, takeaway: "Opening", role: "opening", draft },
				{
					position: 2,
					takeaway: "Broken",
					role: "evidence",
					draft: { layout: "stats", nodes: [] },
				},
			],
		});
		const body = (await response.json()) as { results: Array<Record<string, unknown>> };
		expect(response.status).toBe(200);
		expect(body.results[0]).toHaveProperty("card");
		expect(body.results[1]).toMatchObject({ position: 2, issue: { path: "card.layout" } });
	});

	it("assembles converted cards into a document", async () => {
		const converted = await post("/v1/cards", {
			operationId: "op-1",
			cards: [{ position: 1, takeaway: "Opening", role: "opening", draft }],
		});
		const { results } = (await converted.json()) as { results: Array<{ card: unknown }> };
		const response = await post("/v1/documents", {
			title: "Grid storage",
			theme: "slate",
			cards: results.map((result) => result.card),
		});
		const body = (await response.json()) as { document: { cardOrder: string[] } };
		expect(response.status).toBe(200);
		expect(body.document.cardOrder).toHaveLength(1);
	});

	it("returns 422 when the assembled document is invalid", async () => {
		const response = await post("/v1/documents", { title: "Empty", theme: "slate", cards: [] });
		expect(response.status).toBe(422);
	});

	it("rejects malformed requests before converting", async () => {
		const response = await post("/v1/cards", { operationId: "op", cards: [{ position: 0 }] });
		expect(response.status).toBe(400);
	});

	it("validates an edited document against the presentation's assets", async () => {
		const converted = await post("/v1/cards", {
			operationId: "op-1",
			cards: [{ position: 1, takeaway: "Opening", role: "opening", draft }],
		});
		const { results } = (await converted.json()) as { results: Array<{ card: unknown }> };
		const assembled = await post("/v1/documents", {
			title: "Grid storage",
			theme: "slate",
			cards: results.map((result) => result.card),
		});
		const { document } = (await assembled.json()) as { document: Record<string, unknown> };

		const valid = await post("/v1/documents/validate", {
			document: { ...document, theme: "paper" },
		});
		expect(valid.status).toBe(200);

		const invalid = await post("/v1/documents/validate", {
			document: { ...document, theme: "neon" },
		});
		expect(invalid.status).toBe(422);
		expect(((await invalid.json()) as { issue: { path: string } }).issue.path).toBe(
			"document.theme",
		);
	});
});
