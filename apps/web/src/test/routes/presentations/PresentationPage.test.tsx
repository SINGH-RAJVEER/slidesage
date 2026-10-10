/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { assembleDocument, convertCards } from "@slidesage/cards";
import { StreamingProvider } from "@slidesage/ui";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import PresentationPage from "../../../routes/presentations/PresentationPage";
import PresentationsGridPage from "../../../routes/presentations/PresentationsGridPage";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function savedDocument(heading = "Grid storage") {
	const [result] = convertCards({
		operationId: "fixture",
		sourceIds: [],
		cards: [
			{
				position: 1,
				takeaway: "Storage is now cheap",
				role: "opening",
				draft: { layout: "title", nodes: [{ type: "heading", text: heading }] },
			},
		],
	});
	if (!result || !("card" in result)) throw new Error("fixture card is invalid");
	return assembleDocument({ title: heading, theme: "slate", cards: [result.card] });
}

/** Stands in for the library, showing the notice a failed open sent it. */
function Library() {
	const state = useLocation().state as { notice?: string } | null;
	return <p>Library: {state?.notice}</p>;
}

function serve(status: string, document: unknown) {
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
			return Response.json({ revision: { revision: 1 }, document });
		}
		return new Response(null, { status: 404 });
	}) as unknown as typeof fetch;
}

function open() {
	const router = createMemoryRouter(
		[
			{ path: "/presentations/:presentationId", element: <PresentationPage /> },
			{ path: "/presentation-error", element: <div>Failed presentation</div> },
			{ path: "/presentations", element: <Library /> },
		],
		{ initialEntries: ["/presentations/pres_1"] },
	);
	const view = render(
		<StreamingProvider>
			<RouterProvider router={router} />
		</StreamingProvider>,
	);
	return Object.assign(view, { router });
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

	it("never saves one deck's edits into another deck at the same revision", async () => {
		const saves: Array<{ url: string; document: string }> = [];
		globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const id = /presentations\/(pres_\d)/.exec(url)?.[1] ?? "";
			const heading = id === "pres_1" ? "Deck one" : "Deck two";
			if (init?.method === "PUT") {
				saves.push({ url, document: JSON.stringify(JSON.parse(String(init.body)).document) });
				return Response.json({ revision: { revision: 2 } });
			}
			if (url.endsWith("/document")) {
				return Response.json({ revision: { revision: 1 }, document: savedDocument(heading) });
			}
			return Response.json({
				presentation: { id, title: heading, slides_data: { title: heading, status: "ready" } },
			});
		}) as unknown as typeof fetch;
		const view = open();

		fireEvent.click(await view.findByRole("button", { name: "Edit" }));
		const heading = view.getByRole("textbox", { name: "Card heading" });
		heading.innerHTML = "Deck one, edited";
		fireEvent.input(heading);
		await act(() => view.router.navigate("/presentations/pres_2"));

		expect(await view.findByRole("heading", { name: "Deck two" })).toBeInTheDocument();
		await waitFor(() => expect(saves).toHaveLength(1));
		expect(saves[0]?.url).toEndWith("/presentations/pres_1/document");
		expect(saves[0]?.document).toContain("Deck one, edited");

		// The second deck opens with its own document, and saves there.
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		const second = view.getByRole("textbox", { name: "Card heading" });
		expect(second.textContent).toBe("Deck two");
		second.innerHTML = "Deck two, edited";
		fireEvent.input(second);
		await waitFor(() => expect(saves).toHaveLength(2), { timeout: 8000 });
		expect(saves[1]?.url).toEndWith("/presentations/pres_2/document");
		expect(saves[1]?.document).not.toContain("Deck one");
	}, 15000);

	it("opens a hovered card, and returns to the library, from what the hovers prefetched", async () => {
		const requests: string[] = [];
		globalThis.fetch = mock(async (input: string | URL | Request) => {
			const url = String(input);
			requests.push(url.replace(/^.*\/presentations/, "/presentations"));
			if (url.includes("/presentations?")) {
				return Response.json({
					presentations: [
						{
							id: "pres_1",
							title: "Grid storage",
							prompt: "Storage",
							slide_count: 1,
							status: "ready",
							has_research: false,
							created_at: "2026-10-06T10:00:00.000Z",
							updated_at: "2026-10-06T10:00:00.000Z",
						},
					],
					total: 1,
					limit: 20,
					offset: 0,
					has_more: false,
				});
			}
			if (url.endsWith("/presentations/pres_1/document")) {
				return Response.json({ revision: { revision: 1 }, document: savedDocument() });
			}
			return Response.json({
				presentation: {
					id: "pres_1",
					title: "Grid storage",
					slides_data: { title: "Grid storage", status: "ready" },
				},
			});
		}) as unknown as typeof fetch;
		const router = createMemoryRouter(
			[
				{ path: "/presentations", element: <PresentationsGridPage /> },
				{ path: "/presentations/:presentationId", element: <PresentationPage /> },
			],
			{ initialEntries: ["/presentations"] },
		);
		const view = render(
			<StreamingProvider>
				<RouterProvider router={router} />
			</StreamingProvider>,
		);

		const card = (await view.findByText("Grid storage")).closest("[data-slot='card']");
		if (!card) throw new Error("presentation card not found");
		fireEvent.focus(card);
		await waitFor(() => expect(requests).toContain("/presentations/pres_1/document"));
		fireEvent.click(card);

		expect(await view.findByRole("article")).toHaveAccessibleName("Card 1: Storage is now cheap");
		expect(requests.filter((url) => url === "/presentations/pres_1")).toHaveLength(1);
		expect(requests.filter((url) => url === "/presentations/pres_1/document")).toHaveLength(1);

		const library = () => requests.filter((url) => url.startsWith("/presentations?"));
		fireEvent.focus(view.getByRole("button", { name: "Back to presentations" }));
		await waitFor(() => expect(library()).toHaveLength(2));
		fireEvent.click(view.getByRole("button", { name: "Back to presentations" }));

		expect(await view.findByText("Grid storage")).toBeInTheDocument();
		expect(library()).toHaveLength(2);
	});
});
