import { describe, expect, it } from "bun:test";
import { CARD_TEMPLATES, THEMES } from "@slidesage/cards";
import { handle, SCHEMA_VERSION_HEADER } from "./handler";

function post(path: string, body: unknown, version = "3") {
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
	it("accepts every shared theme in assembly and validation", async () => {
		const template = CARD_TEMPLATES.find((template) => template.id === "mono-briefing");
		if (!template) throw new Error("Missing briefing template");
		for (const theme of THEMES) {
			const response = await post("/v1/documents", {
				title: template.name,
				theme,
				cards: Object.values(template.document.cards),
				assetIds: Object.keys(template.assets),
			});
			expect(response.status).toBe(200);
			const { document } = (await response.json()) as { document: unknown };
			expect(
				(await post("/v1/documents/validate", { document, assetIds: Object.keys(template.assets) }))
					.status,
			).toBe(200);
		}
	});

	it("validates all starter decks and still rejects unregistered images", async () => {
		for (const template of CARD_TEMPLATES) {
			expect(
				(
					await post("/v1/documents/validate", {
						document: template.document,
						assetIds: Object.keys(template.assets),
					})
				).status,
			).toBe(200);
			expect(
				(await post("/v1/documents/validate", { document: template.document, assetIds: [] }))
					.status,
			).toBe(422);
		}
	});
	it("reports health with its schema version", async () => {
		const response = await handle(new Request("http://converter/health"));
		expect(await response.json()).toEqual({ status: "ok", schemaVersion: 3 });
	});

	it("serves the drafting schema its caller builds prompts from", async () => {
		const response = await handle(new Request("http://converter/v1/schema"));
		const body = (await response.json()) as { schemaVersion: number; layouts: object };
		expect(body.schemaVersion).toBe(3);
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

	it("returns each card of a document in draft form", async () => {
		const converted = await post("/v1/cards", {
			operationId: "op-1",
			cards: [{ position: 1, takeaway: "Opening", role: "opening", draft }],
		});
		const { results } = (await converted.json()) as { results: Array<{ card: { id: string } }> };
		const assembled = await post("/v1/documents", {
			title: "Grid storage",
			theme: "slate",
			cards: results.map((result) => result.card),
		});
		const { document } = (await assembled.json()) as { document: unknown };
		const response = await post("/v1/documents/drafts", { document });
		expect(response.status).toBe(200);
		const { cards } = (await response.json()) as { cards: Record<string, unknown> };
		expect(cards[results[0]?.card.id ?? ""]).toEqual({
			takeaway: "Opening",
			sourceIds: [],
			...draft,
		});
	});
});

describe("template catalog endpoint", () => {
	it("serves the curated document and assets without trusting client URLs", async () => {
		const response = await handle(
			new Request("http://converter/v1/templates", {
				method: "POST",
				headers: { "Content-Type": "application/json", [SCHEMA_VERSION_HEADER]: "3" },
				body: JSON.stringify({
					templateId: "grove-lesson",
					url: "https://example.com/untrusted.jpg",
				}),
			}),
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.document.theme).toBe("grove");
		expect(body.document.cardOrder).toHaveLength(5);
		expect(Object.values(body.assets)).toHaveLength(1);
		expect(JSON.stringify(body)).not.toContain("example.com");
		const missing = await handle(
			new Request("http://converter/v1/templates", {
				method: "POST",
				headers: { [SCHEMA_VERSION_HEADER]: "3" },
				body: JSON.stringify({ templateId: "missing" }),
			}),
		);
		expect(missing.status).toBe(404);
	});
});
