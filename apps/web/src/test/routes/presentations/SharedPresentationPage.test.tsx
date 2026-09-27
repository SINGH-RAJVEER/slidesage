/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { assembleDocument, convertCards } from "@slidesage/cards";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SharedPresentationPage from "../../../routes/presentations/SharedPresentationPage";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function deck() {
	const [result] = convertCards({
		operationId: "shared",
		sourceIds: ["s1"],
		cards: [
			{
				position: 1,
				takeaway: "Opening",
				role: "opening",
				draft: {
					layout: "title",
					sourceIds: ["s1"],
					nodes: [{ type: "heading", text: "Grid storage" }],
				},
			},
		],
	});
	if (!result || !("card" in result)) throw new Error("fixture");
	return assembleDocument({ title: "Grid storage deck", theme: "slate", cards: [result.card] });
}

function open(response: Response) {
	const fetchMock = mock(async (_input: string | URL | Request) => response);
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	const view = render(
		<MemoryRouter initialEntries={["/s/token_1"]}>
			<Routes>
				<Route path="/s/:token" element={<SharedPresentationPage />} />
			</Routes>
		</MemoryRouter>,
	);
	return { view, fetchMock };
}

describe("SharedPresentationPage", () => {
	it("shows the shared deck with its citations and no editing", async () => {
		const { view, fetchMock } = open(
			Response.json({
				document: deck(),
				assets: {},
				sources: [{ url: "https://example.com/storage", title: "Storage outlook" }],
			}),
		);

		expect(await view.findByRole("heading", { name: "Grid storage deck" })).toBeInTheDocument();
		expect(view.getByRole("link", { name: "[1]" })).toHaveAttribute(
			"href",
			"https://example.com/storage",
		);
		expect(view.getByRole("button", { name: "Present" })).toBeInTheDocument();
		expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
		expect(String(fetchMock.mock.calls[0]?.[0])).toEndWith("/shared/token_1");
	});

	it("says when the link no longer works", async () => {
		const { view } = open(
			Response.json({ error: { message: "This link is not valid" } }, { status: 404 }),
		);

		expect(await view.findByText(/This link is not valid/)).toBeInTheDocument();
	});
});
