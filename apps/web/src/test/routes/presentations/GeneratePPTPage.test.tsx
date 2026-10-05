/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { StreamingProvider } from "@slidesage/ui";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import GeneratePPTPage from "../../../routes/presentations/GeneratePPTPage";

function RouteStateProbe() {
	const location = useLocation();
	return <pre>{JSON.stringify(location.state)}</pre>;
}

it("prefills a failed presentation prompt and generation options", () => {
	const view = render(
		<MemoryRouter
			initialEntries={[
				{
					pathname: "/generate",
					state: {
						retry: {
							prompt: "Retry this market analysis",
							slide_count: 12,
							detail_level: "comprehensive",
							tonality: "casual",
							research_enabled: true,
						},
					},
				},
			]}
		>
			<StreamingProvider>
				<Routes>
					<Route path="/generate" element={<GeneratePPTPage />} />
				</Routes>
			</StreamingProvider>
		</MemoryRouter>,
	);

	expect(view.getByRole("textbox", { name: "Prompt" })).toHaveValue("Retry this market analysis");
	expect(view.getByRole("slider", { name: "Slide count" })).toHaveTextContent("12");
	expect(view.getByText("Comprehensive")).toBeInTheDocument();
	expect(view.getByText("Casual")).toBeInTheDocument();
	expect(view.getByRole("button", { name: /Web Research/ })).toHaveClass("bg-white/10");
});

it("takes the retried settings to the outline", async () => {
	const view = render(
		<MemoryRouter
			initialEntries={[
				{
					pathname: "/generate",
					state: {
						retry: {
							prompt: "Retry this market analysis",
							slide_count: 7,
							detail_level: "balanced",
							tonality: "professional",
							research_enabled: false,
							ai: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
							theme: "grove",
						},
						retryPresentationId: "failed_1",
					},
				},
			]}
		>
			<StreamingProvider>
				<Routes>
					<Route path="/generate" element={<GeneratePPTPage />} />
					<Route path="/generate/outline" element={<RouteStateProbe />} />
				</Routes>
			</StreamingProvider>
		</MemoryRouter>,
	);

	fireEvent.click(view.getByRole("button", { name: "Generate" }));

	const state = JSON.parse((await view.findByText(/"prompt"/)).textContent ?? "{}");
	expect(state).toEqual({
		prompt: "Retry this market analysis",
		slideCount: 7,
		detailLevel: "balanced",
		tonality: "professional",
		retryPresentationId: "failed_1",
		theme: "grove",
		ai: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
	});
});

it("offers a research result count only with web research on and takes it to research", async () => {
	const view = render(
		<MemoryRouter
			initialEntries={[
				{
					pathname: "/generate",
					state: {
						retry: {
							prompt: "Research how many sources",
							slide_count: 7,
							detail_level: "balanced",
							tonality: "professional",
							research_enabled: false,
							theme: "grove",
						},
					},
				},
			]}
		>
			<StreamingProvider>
				<Routes>
					<Route path="/generate" element={<GeneratePPTPage />} />
					<Route path="/generate/research" element={<RouteStateProbe />} />
				</Routes>
			</StreamingProvider>
		</MemoryRouter>,
	);

	expect(view.queryByRole("slider", { name: "Research results" })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: /Web Research/ }));
	const slider = view.getByRole("slider", { name: "Research results" });
	expect(slider).toHaveTextContent("5");
	fireEvent.keyDown(slider, { key: "ArrowRight" });
	expect(slider).toHaveTextContent("6");

	fireEvent.click(view.getByRole("button", { name: "Generate" }));

	const state = JSON.parse((await view.findByText(/"prompt"/)).textContent ?? "{}");
	expect(state.maxResults).toBe(6);
});

it("asks for a template before generating", async () => {
	const view = render(
		<MemoryRouter
			initialEntries={[
				{
					pathname: "/generate",
					state: {
						retry: {
							prompt: "Retry this market analysis",
							slide_count: 7,
							detail_level: "balanced",
							tonality: "professional",
							research_enabled: false,
						},
					},
				},
			]}
		>
			<StreamingProvider>
				<Routes>
					<Route path="/generate" element={<GeneratePPTPage />} />
					<Route path="/generate/outline" element={<RouteStateProbe />} />
				</Routes>
			</StreamingProvider>
		</MemoryRouter>,
	);

	fireEvent.click(view.getByRole("button", { name: "Generate" }));

	expect(await view.findByText("Select a template before generating.")).toBeInTheDocument();
	expect(view.queryByText(/"prompt"/)).toBeNull();
});

it("starts generation on Enter even when focus sits on an options-bar control", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mock(async () =>
		Response.json({
			generation: { mode: "openrouter", model: "openrouter/default", billing: "points" },
			eligibility: { eligible: true, slideTokens: 100, minimumPointsExclusive: 50 },
			connections: [],
			models: [],
			selection: null,
		}),
	) as unknown as typeof fetch;

	try {
		const view = render(
			<MemoryRouter initialEntries={["/generate"]}>
				<StreamingProvider>
					<Routes>
						<Route path="/generate" element={<GeneratePPTPage />} />
						<Route path="/generate/outline" element={<RouteStateProbe />} />
					</Routes>
				</StreamingProvider>
			</MemoryRouter>,
		);

		fireEvent.change(view.getByRole("textbox", { name: "Prompt" }), {
			target: { value: "Enter submits from anywhere" },
		});
		const slider = await view.findByRole("slider", { name: "Slide count" });
		fireEvent.focus(slider);
		fireEvent.keyDown(slider, { key: "Enter" });

		expect(
			await view.findByText(/Enter submits from anywhere/, {}, { timeout: 5000 }),
		).toBeInTheDocument();
	} finally {
		globalThis.fetch = originalFetch;
	}
});

it("focuses the prompt box on Enter when the prompt is empty", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mock(async () =>
		Response.json({
			generation: { mode: "openrouter", model: "openrouter/default", billing: "points" },
			eligibility: { eligible: true, slideTokens: 100, minimumPointsExclusive: 50 },
			connections: [],
			models: [],
			selection: null,
		}),
	) as unknown as typeof fetch;

	try {
		const view = render(
			<MemoryRouter initialEntries={["/generate"]}>
				<StreamingProvider>
					<Routes>
						<Route path="/generate" element={<GeneratePPTPage />} />
					</Routes>
				</StreamingProvider>
			</MemoryRouter>,
		);

		await waitFor(() => expect(document.getElementById("prompt")).toBeInTheDocument());
		fireEvent.focus(view.getByRole("slider", { name: "Slide count" }));
		fireEvent.keyDown(view.getByRole("slider", { name: "Slide count" }), { key: "Enter" });
		expect(document.getElementById("prompt")).toHaveFocus();
	} finally {
		globalThis.fetch = originalFetch;
	}
});

it("preserves retry AI selection when routing through research", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mock(async () =>
		Response.json({
			generation: { mode: "byok", model: "gpt-4.1", billing: "provider" },
			eligibility: { eligible: true, slideTokens: 100, minimumPointsExclusive: 50 },
			connections: [],
			models: [],
			selection: null,
		}),
	) as unknown as typeof fetch;

	try {
		const view = render(
			<MemoryRouter
				initialEntries={[
					{
						pathname: "/generate",
						state: {
							retry: {
								prompt: "Research this retry",
								slide_count: 6,
								detail_level: "detailed",
								tonality: "professional",
								research_enabled: true,
								ai: { provider: "openai", model: "gpt-4.1" },
								theme: "grove",
							},
							retryPresentationId: "failed_1",
						},
					},
				]}
			>
				<StreamingProvider>
					<Routes>
						<Route path="/generate" element={<GeneratePPTPage />} />
						<Route path="/generate/research" element={<RouteStateProbe />} />
					</Routes>
				</StreamingProvider>
			</MemoryRouter>,
		);

		fireEvent.click(view.getByRole("button", { name: "Generate" }));

		await waitFor(() =>
			expect(view.getByText(/"retryPresentationId":"failed_1"/)).toBeInTheDocument(),
		);
		expect(view.getByText(/"provider":"openai","model":"gpt-4.1"/)).toBeInTheDocument();
		expect(view.getByText(/"theme":"grove"/)).toBeInTheDocument();
	} finally {
		globalThis.fetch = originalFetch;
	}
});
