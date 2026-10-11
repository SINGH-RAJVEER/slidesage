/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { assembleDocument, convertCards, createTemplateDeck } from "@slidesage/cards";
import { StreamingProvider } from "@slidesage/ui";
import {
	fireEvent,
	render,
	waitFor,
	waitForElementToBeRemoved,
	within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { pageDraftKey } from "../../../hooks/usePageDraft";
import { DeckWorkspace } from "../../../routes/presentations/DeckWorkspace";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function deck(headings = ["Grid storage"]) {
	const cards = convertCards({
		operationId: "workspace",
		sourceIds: [],
		cards: headings.map((heading, index) => ({
			position: index + 1,
			takeaway: index === 0 ? "Opening" : heading,
			role: index === 0 ? "opening" : "insight",
			draft: { layout: "title", nodes: [{ type: "heading", text: heading }] },
		})),
	}).map((result) => {
		if (!("card" in result)) throw new Error("fixture");
		return result.card;
	});
	return assembleDocument({ title: "Grid storage", theme: "slate", cards });
}

function open(onReload = () => {}, document = deck(), revision = 3) {
	const router = createMemoryRouter(
		[
			{
				path: "/presentations/pres_1",
				element: (
					<DeckWorkspace
						presentationId="pres_1"
						document={document}
						revision={revision}
						sources={[]}
						assets={{}}
						onReload={onReload}
					/>
				),
			},
			{ path: "/presentations", element: <p>Library</p> },
		],
		{ initialEntries: ["/presentations/pres_1"] },
	);
	return render(
		<StreamingProvider>
			<RouterProvider router={router} />
		</StreamingProvider>,
	);
}

function typeHeading(view: ReturnType<typeof open>, text: string) {
	const heading = view.getByRole("textbox", { name: "Card heading" });
	heading.innerHTML = text;
	fireEvent.input(heading);
}

describe("DeckWorkspace", () => {
	it("keeps restored edits in conflict when the server has a newer revision", async () => {
		globalThis.fetch = mock(async () => {
			throw new TypeError("network");
		}) as unknown as typeof fetch;
		const first = open();
		fireEvent.click(first.getByRole("button", { name: "Edit" }));
		typeHeading(first, "My local change");
		first.unmount();
		const fetchMock = mock(async () => Response.json({ revision: { revision: 5 } }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const reload = mock(() => {});
		const restored = open(reload, deck(["Changed on another device"]), 4);
		expect(restored.getAllByText("My local change").length).toBeGreaterThan(0);
		fireEvent.click(restored.getByRole("button", { name: "Reload the latest version" }));
		expect(reload).toHaveBeenCalled();
		expect(localStorage.getItem(pageDraftKey(undefined, "document:pres_1"))).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("restores edits after a failed save when the deck is reopened", async () => {
		const requests: Array<Record<string, unknown>> = [];
		globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
			requests.push(JSON.parse(String(init?.body)));
			throw new TypeError("network");
		}) as unknown as typeof fetch;
		const first = open();
		fireEvent.click(first.getByRole("button", { name: "Edit" }));
		typeHeading(first, "Recover my edit");
		fireEvent.click(first.getByRole("button", { name: "Back to presentations" }));
		fireEvent.click(
			within(await first.findByRole("dialog")).getByRole("button", { name: "Leave anyway" }),
		);
		await first.findByText("Library");
		first.unmount();
		const restored = open();
		expect(restored.getAllByText("Recover my edit").length).toBeGreaterThan(0);
		fireEvent.click(restored.getByRole("button", { name: "Edit" }));
		expect(restored.getByRole("textbox", { name: "Card heading" })).toHaveTextContent(
			"Recover my edit",
		);
		const retried: Array<Record<string, unknown>> = [];
		globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
			retried.push(JSON.parse(String(init?.body)));
			return Response.json({ revision: { revision: 4 } });
		}) as unknown as typeof fetch;
		fireEvent.click(restored.getByRole("button", { name: "Back to presentations" }));
		await restored.findByText("Library");
		expect(retried[0]?.["operationId"]).toBe(requests[0]?.["operationId"]);
		expect(retried[0]?.["baseRevision"]).toBe(3);
		expect(localStorage.getItem(pageDraftKey(undefined, "document:pres_1"))).toBeNull();
	});

	it("restores incomplete text edits and clears their draft after a successful save", async () => {
		globalThis.fetch = mock(async () =>
			Response.json({ revision: { revision: 4 } }),
		) as unknown as typeof fetch;
		const first = open();
		fireEvent.click(first.getByRole("button", { name: "Edit" }));
		typeHeading(first, "");
		first.unmount();
		const restored = open();
		fireEvent.click(restored.getByRole("button", { name: "Edit" }));
		expect(restored.getByRole("textbox", { name: "Card heading" })).toHaveTextContent("");
		typeHeading(restored, "Finished heading");
		await restored.findByText("All changes saved", {}, { timeout: 5000 });
		expect(localStorage.getItem(pageDraftKey(undefined, "document:pres_1"))).toBeNull();
	});

	it("saves settled edits on top of the revision it loaded", async () => {
		const bodies: Array<Record<string, unknown>> = [];
		globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			return Response.json({ revision: { revision: 4 } });
		}) as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "Grid batteries");

		await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 8000 });
		expect(bodies[0]).toMatchObject({ baseRevision: 3 });
		expect(String(bodies[0]?.["operationId"])).toMatch(/^[0-9a-f-]{36}$/);
		expect(JSON.stringify(bodies[0]?.["document"])).toContain("Grid batteries");
		expect(await view.findByText("All changes saved")).toBeInTheDocument();
	}, 15000);

	it("repeats a save whose response was lost before saving newer edits", async () => {
		const bodies: Array<{ baseRevision: number; operationId: string; document: unknown }> = [];
		let revision = 3;
		globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			// The first save lands, but its response never arrives.
			revision += bodies.length === 2 ? 0 : 1;
			if (bodies.length === 1) throw new TypeError("network");
			return Response.json({ revision: { revision } });
		}) as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "Grid batteries");
		expect(
			await view.findByText(
				"Unable to save changes. Check your connection.",
				{},
				{ timeout: 8000 },
			),
		).toBeInTheDocument();
		typeHeading(view, "Grid batteries at scale");

		await waitFor(() => expect(bodies).toHaveLength(3), { timeout: 8000 });
		expect(bodies[1]).toEqual(bodies[0] as (typeof bodies)[number]);
		expect(bodies[2]).toMatchObject({ baseRevision: 4 });
		expect(bodies[2]?.operationId).not.toBe(bodies[0]?.operationId);
		expect(JSON.stringify(bodies[2]?.document)).toContain("Grid batteries at scale");
		expect(await view.findByText("All changes saved")).toBeInTheDocument();
	}, 20000);

	it("restores the loaded document when a lost save is undone", async () => {
		const bodies: Array<{ baseRevision: number; operationId: string; document: unknown }> = [];
		globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			if (bodies.length === 1) throw new TypeError("network");
			return Response.json({ revision: { revision: bodies.length === 2 ? 4 : 5 } });
		}) as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "Grid batteries");
		expect(
			await view.findByText(
				"Unable to save changes. Check your connection.",
				{},
				{ timeout: 8000 },
			),
		).toBeInTheDocument();
		fireEvent.click(view.getByRole("button", { name: "Undo" }));

		// The lost save may have landed, so it is confirmed, then undone on the server too.
		await waitFor(() => expect(bodies).toHaveLength(3), { timeout: 8000 });
		expect(bodies[1]).toEqual(bodies[0] as (typeof bodies)[number]);
		expect(bodies[2]).toMatchObject({ baseRevision: 4 });
		expect(JSON.stringify(bodies[2]?.document)).not.toContain("Grid batteries");
		expect(await view.findByText("All changes saved")).toBeInTheDocument();
	}, 20000);

	it("saves edits the timer has not yet saved before leaving the deck", async () => {
		const bodies: Array<{ document: unknown }> = [];
		globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return Response.json({ revision: { revision: 4 } });
		}) as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "Grid batteries");
		fireEvent.click(view.getByRole("button", { name: "Back to presentations" }));

		expect(await view.findByText("Library")).toBeInTheDocument();
		expect(bodies).toHaveLength(1);
		expect(JSON.stringify(bodies[0]?.document)).toContain("Grid batteries");
	});

	it("asks before leaving edits that could not be saved", async () => {
		globalThis.fetch = mock(async () => {
			throw new TypeError("network");
		}) as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "Grid batteries");
		fireEvent.click(view.getByRole("button", { name: "Back to presentations" }));

		const dialog = await view.findByRole("dialog", { name: "Leave without saving?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
		await waitFor(() => expect(view.queryByRole("dialog")).not.toBeInTheDocument());
		expect(view.queryByText("Library")).not.toBeInTheDocument();

		fireEvent.click(view.getByRole("button", { name: "Back to presentations", hidden: true }));
		fireEvent.click(
			within(await view.findByRole("dialog", { name: "Leave without saving?" })).getByRole(
				"button",
				{ name: "Leave anyway" },
			),
		);
		expect(await view.findByText("Library")).toBeInTheDocument();
	});

	it("does not save a document the schema would refuse", async () => {
		const fetchMock = mock(async () => Response.json({ revision: { revision: 4 } }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "");

		expect(
			await view.findByText(
				"A text field is empty. Fill it in or remove it to save.",
				{},
				{ timeout: 8000 },
			),
		).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();

		// Undoing back to the saved document clears the refusal.
		fireEvent.click(view.getByRole("button", { name: "Undo" }));
		expect(await view.findByText("All changes saved")).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	}, 15000);

	it("stops editing when the presentation changed elsewhere", async () => {
		globalThis.fetch = mock(async () =>
			Response.json(
				{
					error: { message: "This presentation was changed elsewhere. Reload it before editing." },
					currentRevision: 5,
				},
				{ status: 409 },
			),
		) as unknown as typeof fetch;
		const onReload = mock(() => {});

		const view = open(onReload);
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "Conflicting edit");

		fireEvent.click(
			await view.findByRole("button", { name: "Reload the latest version" }, { timeout: 8000 }),
		);
		expect(onReload).toHaveBeenCalled();
		expect(view.queryByRole("textbox", { name: "Card heading" })).not.toBeInTheDocument();
	}, 15000);

	it("adds an Unsplash photo to a card and saves it", async () => {
		const assetId = "e".repeat(64);
		const hotlink = "https://images.unsplash.com/photo-1?ixid=x&w=2400";
		const photographerUrl = "https://unsplash.com/@ada?utm_source=slidesage&utm_medium=referral";
		const requests: Array<{ url: string; body?: string }> = [];
		globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
			if (url.includes("/images/search")) {
				const provider = new URL(url, "http://localhost").searchParams.get("provider");
				return Response.json({
					provider,
					providers: ["unsplash"],
					photos: [
						{
							id: "Ab_1",
							alt: "Solar farm",
							provider,
							width: 1600,
							height: 900,
							photographer: "Ada",
							photographerUrl,
							thumbnail: "/t.jpg",
						},
					],
				});
			}
			if (url.endsWith("/assets/stock")) {
				return Response.json(
					{
						assetId,
						alt: "Solar farm",
						asset: {
							url: hotlink,
							mimeType: "image/jpeg",
							width: 1600,
							height: 900,
							source: { type: "stock", provider: "unsplash", photographer: "Ada", photographerUrl },
						},
					},
					{ status: 201 },
				);
			}
			return Response.json({ revision: { revision: 4 } });
		}) as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		fireEvent.click(view.getByRole("button", { name: "Add photo" }));
		expect(await view.findByRole("textbox", { name: "Search photos" })).toHaveValue("Grid storage");
		fireEvent.click(view.getByRole("button", { name: "Search" }));
		expect(await view.findByRole("img", { name: "Solar farm" })).toBeInTheDocument();
		expect(view.getByRole("link", { name: "Photos provided by Unsplash" })).toHaveAttribute(
			"href",
			"https://unsplash.com/?utm_source=slidesage&utm_medium=referral",
		);
		expect(view.queryByRole("group", { name: "Photo library" })).not.toBeInTheDocument();
		expect(view.getByRole("link", { name: "Ada" })).toHaveAttribute("href", photographerUrl);
		fireEvent.click(await view.findByRole("img", { name: "Solar farm" }));

		await waitForElementToBeRemoved(() => view.queryByRole("dialog", { hidden: true }), {
			timeout: 2000,
		});
		// happy-dom keeps Radix's aria-hidden on the page after the dialog
		// closes; the browser check covers that the page is interactive again.
		const carousel = view.getByRole("listbox", { name: "Slides carousel", hidden: true });
		const article = within(carousel).getByRole("article", { hidden: true });
		const photo = within(article).getByRole("img", { name: "Solar farm", hidden: true });
		expect(photo).toHaveAttribute("src", hotlink);
		expect(article).toHaveAttribute("data-layout", "cover");
		expect(
			JSON.parse(requests.find((request) => request.url.endsWith("/assets/stock"))?.body ?? "{}"),
		).toEqual({
			provider: "unsplash",
			photoId: "Ab_1",
			query: "Grid storage",
		});
		await waitFor(
			() =>
				expect(requests.some((request) => request.body?.includes(`"assetId":"${assetId}"`))).toBe(
					true,
				),
			{ timeout: 8000 },
		);
	}, 15000);

	it("saves pending edits, then asks AI to revise one card from the saved revision", async () => {
		const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
		globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (url.endsWith("/document")) return Response.json({ revision: { revision: 4 } });
			if (url.endsWith("/presentation-jobs")) {
				return Response.json(
					{ job_id: "job_1", presentation_id: "pres_1", status: "queued" },
					{ status: 202 },
				);
			}
			// The revision's event stream stays open for the rest of the test.
			return new Promise<Response>(() => {});
		}) as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "Grid batteries");
		fireEvent.click(view.getByRole("button", { name: "Revise this card with AI", hidden: true }));
		fireEvent.click(await view.findByRole("button", { name: "Make it more concise" }));

		await waitFor(
			() =>
				expect(requests.some((request) => request.url.endsWith("/presentation-jobs"))).toBe(true),
			{
				timeout: 8000,
			},
		);
		const methods = requests.map(
			(request) => `${request.method} ${request.url.split("/").slice(-1)[0]}`,
		);
		expect(methods.indexOf("PUT document")).toBeLessThan(methods.indexOf("POST presentation-jobs"));
		const job = requests.find((request) => request.url.endsWith("/presentation-jobs"));
		expect(job?.body).toMatchObject({
			topic: "Make it more concise",
			parent_presentation_id: "pres_1",
			base_revision: 4,
			card_ids: [deck().cardOrder[0]],
		});
		expect(await view.findByText(/read-only until the revision is saved/)).toBeInTheDocument();
		expect(view.getByRole("button", { name: "Edit" })).toBeDisabled();
		expect(view.queryByRole("textbox", { name: "Card heading" })).toBeNull();
	}, 15000);
	it("downloads the saved deck as PPTX under the file name the server gives it", async () => {
		const urls: string[] = [];
		globalThis.fetch = mock(async (input: string | URL | Request) => {
			urls.push(String(input));
			return new Response("PK", {
				headers: {
					"Content-Disposition": `attachment; filename="Grid storage.pptx"; filename*=UTF-8''Grid%20storage%20%C3%A9.pptx`,
				},
			});
		}) as unknown as typeof fetch;
		const createObjectURL = URL.createObjectURL;
		const click = HTMLAnchorElement.prototype.click;
		const downloads: string[] = [];
		URL.createObjectURL = () => "blob:deck";
		HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
			downloads.push(`${this.download} ${this.href}`);
		};
		try {
			const view = open();
			fireEvent.pointerDown(view.getByRole("button", { name: /Download/ }), {
				button: 0,
				ctrlKey: false,
			});
			fireEvent.click(await view.findByText("PowerPoint"));
			await waitFor(() => expect(downloads).toEqual(["Grid storage \u00e9.pptx blob:deck"]));
			expect(urls[0]).toEndWith("/presentations/pres_1/export/pptx");
		} finally {
			URL.createObjectURL = createObjectURL;
			HTMLAnchorElement.prototype.click = click;
		}
	});

	it("deletes the slide on screen in one click, then puts it back on Undo", async () => {
		const bodies: Array<{ document: { cardOrder: string[] } }> = [];
		globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return Response.json({ revision: { revision: 4 } });
		}) as unknown as typeof fetch;
		const document = deck(["Grid storage", "Prices fell"]);

		const view = open(() => {}, document);
		fireEvent.click(view.getByRole("button", { name: "Delete slide" }));
		expect(view.queryByRole("dialog")).toBeNull();

		await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 8000 });
		expect(bodies[0]?.document.cardOrder).toEqual(document.cardOrder.slice(1));

		const notice = view.getByText("Slide deleted").closest("[role=status]") as HTMLElement;
		fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));
		await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 8000 });
		expect(bodies[1]?.document.cardOrder).toEqual(document.cardOrder);
	}, 20000);
});

describe("workspace templates", () => {
	it("applies the chosen colors and fonts without replacing content", async () => {
		const saves: Array<{ document: { theme: string } }> = [];
		globalThis.fetch = mock(async (_input: unknown, init?: RequestInit) => {
			saves.push(JSON.parse(String(init?.body)));
			return Response.json({ revision: { revision: 4 } });
		}) as unknown as typeof fetch;
		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		fireEvent.click(view.getByRole("button", { name: "Templates" }));
		const dialog = within(view.getByRole("dialog"));
		fireEvent.click(
			within(
				dialog
					.getByRole("heading", { name: "How a forest works", level: 3 })
					.closest("section") as HTMLElement,
			).getByRole("button", { name: "Apply theme" }),
		);
		fireEvent.click(view.getByRole("button", { name: "Done" }));
		await waitFor(() => expect(saves).toHaveLength(1));
		expect(saves[0]?.document.theme).toBe("grove");
		expect(JSON.stringify(saves[0]?.document)).toContain("Grid storage");
		expect(JSON.stringify(saves[0]?.document)).not.toContain("How a forest works");
	});

	it("registers template photos before saving a replacement and can undo it", async () => {
		const calls: string[] = [];
		const starter = createTemplateDeck("ocean-proposal");
		const saves: unknown[] = [];
		globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
			calls.push(String(input));
			if (String(input).includes("/templates/")) return Response.json(starter);
			saves.push(JSON.parse(String(init?.body)));
			return Response.json({ revision: { revision: 4 + saves.length } });
		}) as unknown as typeof fetch;
		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		fireEvent.click(view.getByRole("button", { name: "Templates" }));
		const dialog = view.getByRole("dialog");
		fireEvent.click(
			within(
				view
					.getByRole("heading", { name: "A better place to work", level: 3 })
					.closest("section") as HTMLElement,
			).getByRole("button", { name: "Replace all slides" }),
		);
		await waitForElementToBeRemoved(dialog);
		expect(calls[0]).toContain("/templates/ocean-proposal");
		await waitFor(() => expect(saves).toHaveLength(1), { timeout: 5000 });
		expect(JSON.stringify(saves[0])).toContain("A better place to work");
		expect(JSON.stringify(saves[0])).toContain(Object.keys(starter.assets)[0] ?? "missing asset");
		fireEvent.click(view.getByRole("button", { name: "Undo" }));
		expect(view.getByRole("textbox", { name: "Card heading" }).textContent).toBe("Grid storage");
	}, 15000);
});
