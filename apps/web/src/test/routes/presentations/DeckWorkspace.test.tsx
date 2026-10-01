/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { assembleDocument, convertCards } from "@slidesage/cards";
import { StreamingProvider } from "@slidesage/ui";
import {
	fireEvent,
	render,
	waitFor,
	waitForElementToBeRemoved,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

function open(onReload = () => {}, document = deck()) {
	return render(
		<MemoryRouter>
			<StreamingProvider>
				<DeckWorkspace
					presentationId="pres_1"
					document={document}
					revision={3}
					sources={[]}
					assets={{}}
					onReload={onReload}
				/>
			</StreamingProvider>
		</MemoryRouter>,
	);
}

function typeHeading(view: ReturnType<typeof open>, text: string) {
	const heading = view.getByRole("textbox", { name: "Card heading" });
	heading.innerHTML = text;
	fireEvent.input(heading);
}

describe("DeckWorkspace", () => {
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

	it("adds a photo searched in another library to a card and saves it", async () => {
		const assetId = "e".repeat(64);
		const requests: Array<{ url: string; body?: string }> = [];
		globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
			if (url.includes("/images/search")) {
				const provider = new URL(url, "http://localhost").searchParams.get("provider") ?? "pexels";
				const photo =
					provider === "unsplash"
						? { id: "Ab_1", alt: "Solar farm" }
						: { id: "7", alt: "Wind farm" };
				return Response.json({
					provider,
					providers: ["pexels", "unsplash"],
					photos: [
						{
							...photo,
							provider,
							width: 1600,
							height: 900,
							photographer: "Ada",
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
							mimeType: "image/jpeg",
							width: 1600,
							height: 900,
							source: { type: "stock", provider: "unsplash", photographer: "Ada" },
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
		expect(await view.findByRole("img", { name: "Wind farm" })).toBeInTheDocument();
		expect(view.getByRole("link", { name: "Photos provided by Pexels" })).toBeInTheDocument();
		fireEvent.click(view.getByRole("button", { name: "Unsplash" }));
		fireEvent.click(await view.findByRole("img", { name: "Solar farm" }));

		await waitForElementToBeRemoved(() => view.queryByRole("dialog", { hidden: true }), {
			timeout: 2000,
		});
		// happy-dom keeps Radix's aria-hidden on the page after the dialog
		// closes; the browser check covers that the page is interactive again.
		const carousel = view.getByRole("listbox", { name: "Slides carousel", hidden: true });
		const article = within(carousel).getByRole("article", { hidden: true });
		const photo = within(article).getByRole("img", { name: "Solar farm", hidden: true });
		expect(photo.getAttribute("src")).toEndWith(`/presentations/pres_1/assets/${assetId}`);
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

	it("asks before deleting the slide on screen, then saves the deck without it", async () => {
		const bodies: Array<{ document: { cardOrder: string[] } }> = [];
		globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return Response.json({ revision: { revision: 4 } });
		}) as unknown as typeof fetch;
		const document = deck(["Grid storage", "Prices fell"]);

		const view = open(() => {}, document);
		fireEvent.click(view.getByRole("button", { name: "Delete slide" }));
		expect(bodies).toHaveLength(0);
		const dialog = await view.findByRole("dialog", { name: "Delete this slide?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete slide" }));

		await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 8000 });
		expect(bodies[0]?.document.cardOrder).toEqual(document.cardOrder.slice(1));
	}, 15000);
});
