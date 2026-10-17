import { describe, expect, it } from "bun:test";
import { request as httpRequest } from "node:http";
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
	let body = request.body;
	if (body && !request.headers.has("Content-Length")) {
		// Bun can infer a byte length from a Request's buffered body. Keep
		// undeclared bodies streaming so the target sees the original headers.
		const reader = body.getReader();
		body = new ReadableStream({
			async pull(controller) {
				const chunk = await reader.read();
				if (chunk.done) controller.close();
				else controller.enqueue(chunk.value);
			},
			cancel(reason) {
				return reader.cancel(reason);
			},
		});
	}
	return fetch(new URL(url.pathname + url.search, base), {
		method: request.method,
		headers: request.headers,
		body,
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

// Prepare card fixtures with the reference until the card conversion route is ported.
function referencePost(path: string, body: unknown) {
	return referenceHandle(
		new Request(`http://converter${path}`, {
			method: "POST",
			headers: { [SCHEMA_VERSION_HEADER]: "3" },
			body: JSON.stringify(body),
		}),
	);
}

function rawPost(base: string, path: string, headers: string[] = []) {
	return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
		const request = httpRequest(base, { method: "POST", path, headers }, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("error", reject);
			response.on("end", () => {
				try {
					resolve({
						status: response.statusCode ?? 0,
						body: JSON.parse(Buffer.concat(chunks).toString()),
					});
				} catch (error) {
					reject(error);
				}
			});
		});
		request.setTimeout(5000, () => request.destroy(new Error("converter request timed out")));
		request.on("error", reject);
		request.end(JSON.stringify({ templateId: "grove-lesson" }));
	});
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
		const converted = await referencePost("/v1/cards", {
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
		const converted = await referencePost("/v1/cards", {
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
		const converted = await referencePost("/v1/cards", {
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
	it("matches every shared template document and asset in full", async () => {
		for (const { id, document, assets } of CARD_TEMPLATES) {
			const response = await post("/v1/templates", { templateId: id });
			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("application/json;charset=utf-8");
			expect(await response.json()).toEqual({ document, assets });
		}
	});

	it("matches template lookup typing, whitespace and duplicate-key behavior", async () => {
		const bodies = [
			"{}",
			...[
				null,
				false,
				0,
				[],
				{},
				"",
				" \t\n",
				"\u0085",
				"\ufeff",
				"\u00a0\u2000\u2028\u2029\u3000",
				" grove-lesson ",
				"GROVE-LESSON",
				"missing",
				"constructor",
				"__proto__",
				"grove-lesson",
			].map((templateId) => JSON.stringify({ templateId })),
			'{"templateId":"missing","templateId":"grove-lesson"}',
			'{"templateId":"grove-lesson","templateId":null}',
			'{"templateId":"grove-lesson","ignored":1e999}',
			'{"templateId":1e999}',
			'{"templateId":"\\ud800"}',
			'{"templateId":"grove-lesson","\\udfff":"\\ud800"}',
		];
		for (const body of bodies) {
			const request = new Request("http://converter/v1/templates", {
				method: "POST",
				headers: { [SCHEMA_VERSION_HEADER]: "3" },
				body,
			});
			const expected = await referenceHandle(request.clone());
			const response = await handle(request);
			expect(response.status, body).toBe(expected.status);
			expect(await response.json(), body).toEqual(await expected.json());
		}
	});

	it("matches template JSON parsing and UTF-16 body limits", async () => {
		const limit = 1024 * 1024;
		const prefix = '{"templateId":"grove-lesson","ignored":"';
		const cases: Array<{ body: string | Uint8Array<ArrayBuffer>; declared?: string }> = [
			{ body: "" },
			{ body: "{" },
			{ body: "{}{}" },
			{ body: "null" },
			{ body: "[]" },
			{ body: "true" },
			{ body: "1e999" },
			{ body: '"grove-lesson"' },
			{ body: '\ufeff{"templateId":"grove-lesson"}' },
			{
				body: new Uint8Array([
					123, 34, 116, 101, 109, 112, 108, 97, 116, 101, 73, 100, 34, 58, 34, 255, 34, 125,
				]),
			},
			{ body: `${prefix}${"a".repeat(limit - prefix.length - 2)}"}` },
			{ body: `${prefix}${"a".repeat(limit - prefix.length - 1)}"}` },
			{ body: `${prefix}${"界".repeat(limit - prefix.length - 2)}"}` },
			{ body: `${prefix}${"界".repeat(limit - prefix.length - 1)}"}` },
			{ body: `${prefix}${"\u{1f980}".repeat(Math.floor((limit - prefix.length - 2) / 2))}"}` },
			{ body: `${prefix}${"\u{1f980}".repeat(Math.floor((limit - prefix.length - 2) / 2) + 1)}"}` },
			{ body: " ".repeat(limit + 1), declared: String(limit + 1) },
		];
		for (const { body, declared } of cases) {
			const request = new Request("http://converter/v1/templates", {
				method: "POST",
				headers: {
					[SCHEMA_VERSION_HEADER]: "3",
					...(declared ? { "Content-Length": declared } : {}),
				},
				body,
			});
			const expected = await referenceHandle(request.clone());
			const response = await handle(request);
			expect(response.status).toBe(expected.status);
			expect(response.headers.get("Content-Type")).toBe(expected.headers.get("Content-Type"));
			expect(await response.json()).toEqual(await expected.json());
		}
	});

	it("checks template versions before parsing and preserves exact route matching", async () => {
		for (const version of [undefined, "", "1", "03", "3.0", "3"]) {
			const request = new Request("http://converter/v1/templates?source=starter", {
				method: "POST",
				headers: version === undefined ? {} : { [SCHEMA_VERSION_HEADER]: version },
				body: "not json",
			});
			const expected = await referenceHandle(request.clone());
			const response = await handle(request);
			expect(response.status).toBe(expected.status);
			expect(await response.json()).toEqual(await expected.json());
		}
		for (const method of ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
			const response = await handle(new Request("http://converter/v1/templates", { method }));
			expect(response.status).toBe(404);
			if (method !== "HEAD") expect(await response.json()).toEqual({ error: "not found" });
		}
		for (const path of ["/v1/templates/", "/v1/%74emplates"]) {
			const response = await post(path, { templateId: "grove-lesson" });
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: "not found" });
		}
	});

	it("matches Bun HTTP header encoding, duplicate versions and URL normalization", async () => {
		const reference = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: referenceHandle });
		const referenceURL = `http://127.0.0.1:${reference.port}`;
		const target = process.env["CONVERTER_UNDER_TEST_URL"] || referenceURL;
		try {
			const sendVersion = (base: string) =>
				fetch(`${base}/v1/templates`, {
					method: "POST",
					headers: { [SCHEMA_VERSION_HEADER]: "\u00e9" },
					body: "{}",
				});
			const expected = await sendVersion(referenceURL);
			const response = await sendVersion(target);
			expect(response.status).toBe(expected.status);
			expect(await response.json()).toEqual(await expected.json());
			for (const versions of [
				["3", "3"],
				["3", "1"],
				["1", "3"],
			]) {
				const headers = versions.flatMap((version) => [SCHEMA_VERSION_HEADER, version]);
				expect(await rawPost(target, "/v1/templates", headers)).toEqual(
					await rawPost(referenceURL, "/v1/templates", headers),
				);
			}
			for (const path of [
				"/v1/./templates",
				"/discard/../v1/templates",
				"/v1/%2e/templates",
				"/discard/%2e%2E/v1/templates",
				"/v1\\templates",
				"/v1/templates/.",
				"/v1/templates/..",
				"/v1//templates",
			]) {
				const headers = [SCHEMA_VERSION_HEADER, "3"];
				expect(await rawPost(target, path, headers), path).toEqual(
					await rawPost(referenceURL, path, headers),
				);
			}
		} finally {
			await reference.stop(true);
		}
	});

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

describe("document validation parity", () => {
	async function compare(body: string, label: string) {
		const make = () =>
			new Request("http://converter/v1/documents/validate", {
				method: "POST",
				headers: { "Content-Type": "application/json", [SCHEMA_VERSION_HEADER]: "3" },
				body,
			});
		const reference = await referenceHandle(make());
		const actual = await handle(make());
		expect({ label, status: actual.status, body: await actual.json() }).toEqual({
			label,
			status: reference.status,
			body: await reference.json(),
		});
	}
	function simpleDocument(
		nodes: unknown[] = [{ id: "n_heading1", type: "heading", text: [{ text: "A heading" }] }],
		layout = "title",
	) {
		return {
			schemaVersion: 3,
			title: "A document",
			theme: "paper",
			cardOrder: ["c_first001"],
			cards: {
				c_first001: {
					id: "c_first001",
					takeaway: "One point",
					role: "opening",
					layout,
					nodes,
					sourceIds: ["s1", "s1", "s2"],
				},
			},
		};
	}
	it("normalizes every template and old schema version with exact asset checks", async () => {
		for (const template of CARD_TEMPLATES) {
			for (const schemaVersion of [1, 2, 3]) {
				await compare(
					JSON.stringify({
						document: { ...template.document, schemaVersion },
						assetIds: Object.keys(template.assets),
					}),
					`${template.id} version ${schemaVersion}`,
				);
			}
			await compare(
				JSON.stringify({ document: template.document, assetIds: [] }),
				`${template.id} unregistered assets`,
			);
		}
	});
	it("matches first issues for every template field and node", async () => {
		for (const template of CARD_TEMPLATES) {
			const original = { document: template.document, assetIds: Object.keys(template.assets) };
			const paths: string[][] = [];
			function visit(value: unknown, path: string[]) {
				if (Array.isArray(value)) {
					value.forEach((entry, index) => {
						visit(entry, [...path, String(index)]);
					});
					return;
				}
				if (typeof value !== "object" || value === null) return;
				for (const [key, entry] of Object.entries(value)) {
					paths.push([...path, key]);
					visit(entry, [...path, key]);
				}
			}
			visit(original.document, ["document"]);
			for (const path of paths) {
				for (const replacement of [undefined, null, false, [], {}, "", "\ufeff"]) {
					const changed = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
					let parent = changed;
					for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
					const key = path.at(-1) ?? "";
					if (replacement === undefined) delete parent[key];
					else parent[key] = replacement;
					await compare(
						JSON.stringify(changed),
						`${template.id} ${path.join(".")}=${JSON.stringify(replacement)}`,
					);
				}
			}
		}
	}, 120000);
	it("matches widget constraints, ID order and all layout rules", async () => {
		const heading = { id: "n_heading1", type: "heading", text: [{ text: "Heading" }] };
		const chart = {
			id: "n_chart001",
			type: "chart",
			kind: "column",
			size: "medium",
			categories: ["A", "B"],
			series: [{ id: "s_series01", name: "Revenue", values: [1, 2] }],
		};
		const progress = {
			id: "n_meter001",
			type: "progress",
			size: "small",
			items: [{ id: "i_meter001", label: "Done", value: 50 }],
		};
		const table = {
			id: "n_table001",
			type: "table",
			size: "large",
			columns: ["A", "B"],
			rows: [{ id: "r_row0001", cells: ["", "Value"] }],
		};
		const callout = {
			id: "n_call0001",
			type: "callout",
			size: "small",
			tone: "note",
			text: [{ text: "Attention", bold: true }],
		};
		for (const layout of Object.keys(draftingSchema().layouts)) {
			for (const nodes of [
				[],
				[heading],
				[heading, chart],
				[heading, table],
				[heading, progress, callout],
				[heading, chart, progress, table, callout],
			]) {
				await compare(
					JSON.stringify({ document: simpleDocument(nodes, layout) }),
					`${layout} ${nodes.map((node) => node.type).join(",")}`,
				);
			}
		}
		for (const kind of [
			"column",
			"bar",
			"stacked-column",
			"line",
			"area",
			"pie",
			"donut",
			"invalid",
		]) {
			for (const values of [[0, 0], [-1, 2], [1, 2], [1], [1, 1e13]]) {
				await compare(
					JSON.stringify({
						document: simpleDocument(
							[heading, { ...chart, kind, series: [{ ...chart.series[0], values }] }],
							"chart",
						),
					}),
					`chart ${kind} ${values}`,
				);
			}
		}
		for (const size of ["small", "medium", "large", "full", "invalid"]) {
			await compare(
				JSON.stringify({
					document: simpleDocument([heading, { ...progress, size }, callout], "dashboard"),
				}),
				`dashboard ${size}`,
			);
		}
		for (const type of [
			undefined,
			null,
			false,
			1,
			1e-7,
			1e-6,
			1e20,
			1e21,
			Number("2116746914230136.25"),
			Number("763677196871030.25"),
			Number("230459269801584.625"),
			{ a: 1 },
			[1, "x"],
			"bad",
		]) {
			await compare(
				JSON.stringify({ document: simpleDocument([{ type }]) }),
				`unsupported type ${JSON.stringify(type)}`,
			);
		}
	});
	it("matches Unicode lengths, unknown-key order and malformed request data", async () => {
		for (const content of [
			"\ud800",
			"\udfff",
			"😀".repeat(90),
			"😀".repeat(91),
			"\u0085",
			"\ufeff",
			"\ud800".repeat(91),
		]) {
			await compare(
				JSON.stringify({
					document: simpleDocument([
						{ id: "n_heading1", type: "heading", text: [{ text: content }] },
					]),
				}),
				`text ${content.length}`,
			);
		}
		await compare(
			JSON.stringify({
				document: simpleDocument(
					[
						{ id: "n_heading1", type: "heading", text: [{ text: "Heading" }] },
						{
							id: "n_columns1",
							type: "columns",
							columns: [
								{ id: "c_column01", heading: "\ud800", items: [] },
								{ id: "c_column02", heading: "Other", items: [] },
							],
						},
					],
					"comparison",
				),
			}),
			"surrogate column count issue",
		);
		const splitPair = simpleDocument([
			{
				id: "n_heading1",
				type: "heading",
				text: [{ text: "\ud83d" }, { text: "\ude00".repeat(90) }],
			},
		]);
		await compare(JSON.stringify({ document: splitPair }), "UTF16 pair crossing rich text runs");
		for (const name of [
			"toString",
			"constructor",
			"__proto__",
			"hasOwnProperty",
			"__defineGetter__",
		]) {
			await compare(
				JSON.stringify({
					document: { ...simpleDocument(), cardOrder: [name], cards: { [name]: {} } },
				}),
				`prototype ${name}`,
			);
		}
		for (const cardOrder of [
			[{ toString: null }],
			[[{ toString: 0 }]],
			[{ toString: {} }],
			[{ valueOf: null }],
		]) {
			for (const cards of [null, {}, { "[object Object]": {} }]) {
				await compare(
					JSON.stringify({ document: { ...simpleDocument(), cardOrder, cards } }),
					`coercion ${JSON.stringify(cardOrder)} cards=${JSON.stringify(cards)}`,
				);
			}
		}
		const base = JSON.stringify({ document: simpleDocument() });
		for (const body of [
			"",
			"{",
			"null",
			"[]",
			"true",
			"0",
			'{"assetIds":[null]}',
			'{"assetIds":false}',
			'{"assetIds":["\ufeff"]}',
			'{"document":{"z":1,"10":1,"2":1,"a":2}}',
			'{"document":{"schemaVersion":3,"cardOrder":[1e999],"cards":{"Infinity":{}}}}',
			'{"document":{"\\ud800":1,"a":2}}',
			base.replace('"type":"heading"', '"type":1e999'),
			base.replace('"schemaVersion":3', '"schemaVersion":1e999'),
			base.replace('"type":"heading"', '"type":{"z":1,"2":2,"a":-0,"n":1e999}'),
			base.replace('"title":"A document"', '"title":"bad","title":"A document"'),
		]) {
			await compare(body, `raw ${body.slice(0, 100)}`);
		}
	});
});
