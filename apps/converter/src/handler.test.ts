import { describe, expect, it } from "bun:test";
import { CARD_TEMPLATES, draftingSchema, THEMES } from "@slidesage/cards";
import { handle as referenceHandle, SCHEMA_VERSION_HEADER } from "./handler";

// One transport switch for every case. Unported routes fail when targeting Rust.
function handle(request: Request): Promise<Response> {
	const target = process.env["CONVERTER_UNDER_TEST_URL"];
	if (!target) return referenceHandle(request);
	const base = new URL(target);
	if (base.protocol !== "http:" && base.protocol !== "https:") {
		throw new Error("CONVERTER_UNDER_TEST_URL must be an HTTP test worker");
	}
	const url = new URL(request.url);
	return fetch(new URL(url.pathname + url.search, base), {
		method: request.method,
		headers: request.headers,
		body: request.body,
		redirect: "manual",
		signal: AbortSignal.timeout(5000),
	});
}

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
		expect(response.headers.get("Content-Type")).toBe("application/json;charset=utf-8");
		expect(await response.json()).toEqual({ status: "ok", schemaVersion: 3 });
	});

	it("serves the drafting schema its caller builds prompts from", async () => {
		const response = await handle(new Request("http://converter/v1/schema"));
		const body = (await response.json()) as { schemaVersion: number; layouts: object };
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/json;charset=utf-8");
		expect(body.schemaVersion).toBe(3);
		expect(Object.keys(body.layouts)).toContain("comparison");
		expect(body).toEqual(draftingSchema());
	});

	it("preserves schema routing and version-header behavior", async () => {
		for (const version of [undefined, "1", "3"]) {
			const response = await handle(
				new Request("http://converter/v1/schema?source=prompt", {
					headers: version ? { [SCHEMA_VERSION_HEADER]: version } : {},
				}),
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(draftingSchema());
		}
		for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
			const response = await handle(new Request("http://converter/v1/schema", { method }));
			expect(response.status).toBe(404);
			if (method !== "HEAD") expect(await response.json()).toEqual({ error: "not found" });
		}
		const response = await handle(new Request("http://converter/v1/schema/"));
		expect(response.status).toBe(404);
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
