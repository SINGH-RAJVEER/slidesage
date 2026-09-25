/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { assembleDocument, convertCards } from "@slidesage/cards";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { DeckWorkspace } from "../../../routes/presentations/DeckWorkspace";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function deck() {
	const [result] = convertCards({
		operationId: "workspace",
		sourceIds: [],
		cards: [
			{
				position: 1,
				takeaway: "Opening",
				role: "opening",
				draft: { layout: "title", nodes: [{ type: "heading", text: "Grid storage" }] },
			},
		],
	});
	if (!result || !("card" in result)) throw new Error("fixture");
	return assembleDocument({ title: "Grid storage", theme: "slate", cards: [result.card] });
}

function open(onReload = () => {}) {
	return render(
		<DeckWorkspace
			presentationId="pres_1"
			document={deck()}
			revision={3}
			sources={[]}
			assets={{}}
			onReload={onReload}
		/>,
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

		await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 4000 });
		expect(bodies[0]).toMatchObject({ baseRevision: 3 });
		expect(String(bodies[0]?.["operationId"])).toMatch(/^[0-9a-f-]{36}$/);
		expect(JSON.stringify(bodies[0]?.["document"])).toContain("Grid batteries");
		expect(await view.findByText("All changes saved")).toBeInTheDocument();
	});

	it("does not save a document the schema would refuse", async () => {
		const fetchMock = mock(async () => Response.json({ revision: { revision: 4 } }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const view = open();
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "");

		expect(
			await view.findByText("A text field is empty. Fill it in or remove it to save.", {}, { timeout: 4000 }),
		).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("stops editing when the presentation changed elsewhere", async () => {
		globalThis.fetch = mock(async () =>
			Response.json(
				{ error: { message: "This presentation was changed elsewhere. Reload it before editing." }, currentRevision: 5 },
				{ status: 409 },
			),
		) as unknown as typeof fetch;
		const onReload = mock(() => {});

		const view = open(onReload);
		fireEvent.click(view.getByRole("button", { name: "Edit" }));
		typeHeading(view, "Conflicting edit");

		fireEvent.click(await view.findByRole("button", { name: "Reload the latest version" }, { timeout: 4000 }));
		expect(onReload).toHaveBeenCalled();
		expect(view.queryByRole("textbox", { name: "Card heading" })).not.toBeInTheDocument();
	});
});
