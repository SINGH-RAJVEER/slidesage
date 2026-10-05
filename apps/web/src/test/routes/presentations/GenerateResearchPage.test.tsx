/// <reference lib="dom" />

import { describe, expect, it, mock } from "bun:test";
import { StreamingProvider } from "@slidesage/ui";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import GenerateResearchPage from "../../../routes/presentations/GenerateResearchPage";

function OutlineStateProbe() {
	const location = useLocation();
	return <pre data-testid="outline-state">{JSON.stringify(location.state)}</pre>;
}

function AwayPage() {
	const navigate = useNavigate();

	return (
		<div>
			<span>Presentations</span>
			<button type="button" onClick={() => navigate(1)}>
				Return to research
			</button>
		</div>
	);
}

describe("GenerateResearchPage", () => {
	it("shows saved retry sources without repeating the research request", async () => {
		const originalFetch = globalThis.fetch;
		const fetchMock = mock(async () => new Response(null, { status: 500 }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const view = render(
				<MemoryRouter
					initialEntries={[
						{
							pathname: "/generate/research",
							state: {
								prompt: "Saved research topic",
								slideCount: 7,
								detailLevel: "detailed",
								tonality: "persuasive",
								researchPayload: {
									sources: [
										{
											url: "https://example.com/saved",
											title: "Saved source",
											snippet: "Stored with the failed presentation.",
										},
									],
									estimated_tokens: 8.4,
								},
							},
						},
					]}
				>
					<StreamingProvider>
						<Routes>
							<Route path="/generate/research" element={<GenerateResearchPage />} />
						</Routes>
					</StreamingProvider>
				</MemoryRouter>,
			);

			await waitFor(() => expect(view.getByText("Saved source")).toBeInTheDocument());
			expect(view.getAllByText("Stored with the failed presentation.")).not.toHaveLength(0);
			expect(view.getByText("Proceed to Generate").closest("button")).not.toBeDisabled();
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("leaves removed sources out of the reviewed payload until they are restored", async () => {
		const view = render(
			<MemoryRouter
				initialEntries={[
					{
						pathname: "/generate/research",
						state: {
							prompt: "Coastal erosion",
							slideCount: 5,
							detailLevel: "balanced",
							tonality: "professional",
							researchPayload: {
								sources: [
									{ url: "https://example.com/first", title: "First source" },
									{ url: "https://example.com/second", title: "Second source" },
									{ url: "https://example.com/third", title: "Third source" },
								],
							},
						},
					},
				]}
			>
				<StreamingProvider>
					<Routes>
						<Route path="/generate/research" element={<GenerateResearchPage />} />
						<Route path="/generate/outline" element={<OutlineStateProbe />} />
					</Routes>
				</StreamingProvider>
			</MemoryRouter>,
		);

		await waitFor(() => expect(view.getByText("Second source")).toBeInTheDocument());

		fireEvent.click(view.getByRole("button", { name: "Remove source: Second source" }));
		expect(view.queryByText("Second source")).not.toBeInTheDocument();
		expect(view.getByRole("button", { name: "Remove source: Third source" })).toHaveFocus();

		fireEvent.click(view.getByRole("button", { name: "Remove source: First source" }));
		fireEvent.click(view.getByRole("button", { name: "Restore 2 removed" }));
		expect(view.getByText("First source")).toBeInTheDocument();
		expect(view.getByText("Second source")).toBeInTheDocument();
		expect(view.getByRole("button", { name: "Remove source: First source" })).toHaveFocus();

		fireEvent.click(view.getByRole("button", { name: "Remove source: First source" }));
		fireEvent.click(view.getByText("Proceed to Generate"));

		const state = JSON.parse((await view.findByTestId("outline-state")).textContent ?? "{}");
		expect(state.researchPayload.sources.map((source: { url: string }) => source.url)).toEqual([
			"https://example.com/second",
			"https://example.com/third",
		]);
	});

	it("shows the sources table and Proceed only once research succeeds", async () => {
		const originalFetch = globalThis.fetch;
		let requestCount = 0;
		let resolveResearch: ((response: Response) => void) | undefined;

		globalThis.fetch = mock(() => {
			requestCount += 1;
			return new Promise<Response>((resolve) => {
				resolveResearch = resolve;
			});
		}) as unknown as typeof fetch;

		try {
			const view = render(
				<MemoryRouter
					initialEntries={[
						{
							pathname: "/generate/research",
							state: {
								prompt: "Battery storage market",
								slideCount: 5,
								detailLevel: "balanced",
								tonality: "professional",
								ai: { provider: "google", model: "gemini-2.5-pro" },
							},
						},
					]}
				>
					<StreamingProvider>
						<Routes>
							<Route path="/generate/research" element={<GenerateResearchPage />} />
							<Route path="/generate/outline" element={<OutlineStateProbe />} />
						</Routes>
					</StreamingProvider>
				</MemoryRouter>,
			);

			await waitFor(() => expect(requestCount).toBe(1));
			expect(view.getByText("Searching the web for sources...")).toBeInTheDocument();
			expect(view.queryByText("Proceed to Generate")).not.toBeInTheDocument();
			expect(view.queryByText("Sources")).not.toBeInTheDocument();
			expect(view.queryByRole("columnheader", { name: "Research note" })).not.toBeInTheDocument();

			resolveResearch?.(
				new Response(
					JSON.stringify({
						sources: [
							{
								url: "https://example.com/storage",
								title: "Battery storage outlook",
								snippet: "A complete source preview.",
							},
						],
						estimated_tokens: 5.8,
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			);

			await waitFor(() => {
				expect(view.getByText("Battery storage outlook")).toBeInTheDocument();
			});
			expect(view.getByRole("table", { name: "Research sources" })).toBeInTheDocument();
			expect(view.getByRole("columnheader", { name: "Research note" })).toBeInTheDocument();
			expect(view.getAllByText("A complete source preview.")).not.toHaveLength(0);
			const sourceLink = view.getByRole("link", {
				name: "Open source: Battery storage outlook",
			});
			expect(sourceLink).toHaveAttribute("href", "https://example.com/storage");
			expect(sourceLink).toHaveAttribute("target", "_blank");
			expect(view.getByText("Proceed to Generate").closest("button")).not.toBeDisabled();

			fireEvent.keyDown(sourceLink, { key: "Enter" });
			expect(requestCount).toBe(1);

			fireEvent.keyDown(window, { key: "Enter" });

			const state = JSON.parse((await view.findByTestId("outline-state")).textContent ?? "{}");
			expect(requestCount).toBe(1);
			expect(state.ai).toEqual({ provider: "google", model: "gemini-2.5-pro" });
			expect(state.researchPayload).toEqual({
				sources: [
					{
						url: "https://example.com/storage",
						title: "Battery storage outlook",
						snippet: "A complete source preview.",
					},
				],
				estimated_tokens: 5.8,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	// The Enter shortcut was registered with the handler bound into it, so every
	// render swapped the listener. Between research turning ready on screen and
	// the effect running with the new handler, an Enter press was answered by the
	// closure that still saw a loading page and dropped it. On a loaded machine
	// that window is wide enough to lose the keystroke, which is how it surfaced
	// as an intermittent CI failure.
	it("reports a failed search in a notice and offers a retry in place of Proceed", async () => {
		const originalFetch = globalThis.fetch;
		const fetchMock = mock(
			async () =>
				new Response(JSON.stringify({ error: "Unable to run research" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const view = render(
				<MemoryRouter
					initialEntries={[
						{
							pathname: "/generate/research",
							state: {
								prompt: "Desalination costs",
								slideCount: 5,
								detailLevel: "balanced",
								tonality: "professional",
							},
						},
					]}
				>
					<StreamingProvider>
						<Routes>
							<Route path="/generate/research" element={<GenerateResearchPage />} />
						</Routes>
					</StreamingProvider>
				</MemoryRouter>,
			);

			expect(await view.findByRole("alert")).toHaveTextContent("Unable to run research");
			expect(view.queryByText("Proceed to Generate")).not.toBeInTheDocument();
			expect(view.queryByRole("table", { name: "Research sources" })).not.toBeInTheDocument();

			fireEvent.click(view.getByRole("button", { name: "Retry research" }));
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("binds the Enter shortcut once so a press cannot reach a stale handler", async () => {
		const originalFetch = globalThis.fetch;
		const originalAdd = window.addEventListener.bind(window);
		let resolveResearch: ((response: Response) => void) | undefined;
		let keydownRegistrations = 0;

		globalThis.fetch = mock(
			() =>
				new Promise<Response>((resolve) => {
					resolveResearch = resolve;
				}),
		) as unknown as typeof fetch;
		window.addEventListener = ((type: string, ...rest: unknown[]) => {
			if (type === "keydown") keydownRegistrations += 1;
			return (originalAdd as unknown as (...args: unknown[]) => void)(type, ...rest);
		}) as typeof window.addEventListener;

		try {
			const view = render(
				<MemoryRouter
					initialEntries={[
						{
							pathname: "/generate/research",
							state: {
								prompt: "Tidal power economics",
								slideCount: 5,
								detailLevel: "balanced",
								tonality: "professional",
							},
						},
					]}
				>
					<StreamingProvider>
						<Routes>
							<Route path="/generate/research" element={<GenerateResearchPage />} />
						</Routes>
					</StreamingProvider>
				</MemoryRouter>,
			);

			const registrationsWhileLoading = keydownRegistrations;
			expect(registrationsWhileLoading).toBe(1);

			resolveResearch?.(
				new Response(
					JSON.stringify({
						sources: [{ url: "https://example.com/tidal", title: "Tidal power outlook" }],
						estimated_tokens: 3.1,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);

			await waitFor(() => {
				expect(view.getByText("Tidal power outlook")).toBeInTheDocument();
			});

			expect(keydownRegistrations).toBe(registrationsWhileLoading);
		} finally {
			window.addEventListener = originalAdd as typeof window.addEventListener;
			globalThis.fetch = originalFetch;
		}
	});

	it("keeps research running after leaving the insights page and reuses it on return", async () => {
		const originalFetch = globalThis.fetch;
		let resolveResearch: ((response: Response) => void) | undefined;
		let didAbort = false;

		const fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit) => {
			init?.signal?.addEventListener("abort", () => {
				didAbort = true;
			});

			return new Promise<Response>((resolve) => {
				resolveResearch = resolve;
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const view = render(
				<MemoryRouter
					initialEntries={[
						"/presentations",
						{
							pathname: "/generate/research",
							state: {
								prompt: "Grid storage policy",
								slideCount: 6,
								detailLevel: "balanced",
								tonality: "professional",
							},
						},
					]}
					initialIndex={1}
				>
					<StreamingProvider>
						<Routes>
							<Route path="/presentations" element={<AwayPage />} />
							<Route path="/generate/research" element={<GenerateResearchPage />} />
						</Routes>
					</StreamingProvider>
				</MemoryRouter>,
			);

			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			fireEvent.click(view.getByRole("button", { name: "Go back" }));
			await waitFor(() => expect(view.getByText("Presentations")).toBeInTheDocument());
			expect(didAbort).toBe(false);

			resolveResearch?.(
				new Response(
					JSON.stringify({
						sources: [
							{
								url: "https://example.com/policy",
								title: "Storage policy update",
								snippet: "The request completed while the page was away.",
							},
						],
						estimated_tokens: 6.2,
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			);

			fireEvent.click(view.getByRole("button", { name: "Return to research" }));

			await waitFor(() => {
				expect(view.getByText("Storage policy update")).toBeInTheDocument();
			});
			expect(view.getAllByText("The request completed while the page was away.")).not.toHaveLength(
				0,
			);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
	it("returns to the generate page when the route state is lost", async () => {
		const originalFetch = globalThis.fetch;
		const fetchMock = mock(async () => new Response(null, { status: 500 }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const view = render(
				<MemoryRouter initialEntries={["/generate/research"]}>
					<StreamingProvider>
						<Routes>
							<Route path="/generate" element={<span>Generate</span>} />
							<Route path="/generate/research" element={<GenerateResearchPage />} />
						</Routes>
					</StreamingProvider>
				</MemoryRouter>,
			);

			await waitFor(() => expect(view.getByText("Generate")).toBeInTheDocument());
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
