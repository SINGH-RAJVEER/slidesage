/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { assembleDocument, convertCards } from "@slidesage/cards";
import { StreamingProvider } from "@slidesage/ui";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PresentationPage from "../../../routes/presentations/PresentationPage";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function savedDocument() {
	const [result] = convertCards({
		operationId: "fixture",
		sourceIds: [],
		cards: [
			{
				position: 1,
				takeaway: "Storage is now cheap",
				role: "opening",
				draft: { layout: "title", nodes: [{ type: "heading", text: "Grid storage" }] },
			},
		],
	});
	if (!result || !("card" in result)) throw new Error("fixture card is invalid");
	return assembleDocument({ title: "Grid storage", theme: "slate", cards: [result.card] });
}

function serve(status: string, document: unknown) {
	globalThis.fetch = mock(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/presentations/pres_1")) {
			return Response.json({
				presentation: { id: "pres_1", title: "Grid storage", slides_data: { title: "Grid storage", status } },
			});
		}
		if (url.endsWith("/presentations/pres_1/document")) {
			return Response.json({ revision: { revision: 1 }, document });
		}
		return new Response(null, { status: 404 });
	}) as unknown as typeof fetch;
}

function open() {
	return render(
		<MemoryRouter initialEntries={["/presentations/pres_1"]}>
			<StreamingProvider>
				<Routes>
					<Route path="/presentations/:presentationId" element={<PresentationPage />} />
					<Route path="/presentation-error" element={<div>Failed presentation</div>} />
				</Routes>
			</StreamingProvider>
		</MemoryRouter>,
	);
}

describe("PresentationPage", () => {
	it("renders the saved card document", async () => {
		serve("ready", savedDocument());
		const view = open();

		expect(await view.findByRole("heading", { level: 1, name: "Grid storage" })).toBeInTheDocument();
		expect(view.getByRole("article")).toHaveAccessibleName("Card 1: Storage is now cheap");
	});

	it("sends a failed presentation to its retry page", async () => {
		serve("failed", null);
		const view = open();

		expect(await view.findByText("Failed presentation")).toBeInTheDocument();
	});

	it("refuses to render a document that does not match the schema", async () => {
		serve("ready", { ...savedDocument(), theme: "neon" });
		const view = open();

		expect(
			await view.findByText("This presentation's saved document could not be read."),
		).toBeInTheDocument();
		expect(view.queryByRole("article")).not.toBeInTheDocument();
	});
});
