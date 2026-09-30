/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { assembleDocument, convertCards } from "@slidesage/cards";
import { StreamingProvider } from "@slidesage/ui";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

/** Stands in for the library, showing the notice a failed open sent it. */
function Library() {
	const state = useLocation().state as { notice?: string } | null;
	return <p>Library: {state?.notice}</p>;
}

function serve(status: string, document: unknown, documentStatus = 200) {
	globalThis.fetch = mock(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/presentations/pres_1")) {
			return Response.json({
				presentation: {
					id: "pres_1",
					title: "Grid storage",
					slides_data: { title: "Grid storage", status },
				},
			});
		}
		if (url.endsWith("/presentations/pres_1/document")) {
			if (documentStatus !== 200) {
				return Response.json(
					{ error: { message: "This presentation has no saved document yet" } },
					{ status: documentStatus },
				);
			}
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
					<Route path="/presentations" element={<Library />} />
				</Routes>
			</StreamingProvider>
		</MemoryRouter>,
	);
}

describe("PresentationPage", () => {
	it("renders the saved card document", async () => {
		serve("ready", savedDocument());
		const view = open();

		expect(await view.findByRole("article")).toHaveAccessibleName("Card 1: Storage is now cheap");
		expect(view.getByRole("button", { name: "Go to slide 1" })).toBeInTheDocument();
	});

	it("sends a failed presentation to its retry page", async () => {
		serve("failed", null);
		const view = open();

		expect(await view.findByText("Failed presentation")).toBeInTheDocument();
	});

	it("returns to the library, saying why, when the document does not match the schema", async () => {
		serve("ready", { ...savedDocument(), theme: "neon" });
		const view = open();

		expect(
			await view.findByText("Library: This presentation's saved document could not be read."),
		).toBeInTheDocument();
		expect(view.queryByRole("article")).not.toBeInTheDocument();
	});

	it("returns to the library when the presentation predates card documents", async () => {
		serve("ready", null, 409);
		const view = open();

		expect(await view.findByText(/Library: .*made with an earlier version/)).toBeInTheDocument();
	});
});
