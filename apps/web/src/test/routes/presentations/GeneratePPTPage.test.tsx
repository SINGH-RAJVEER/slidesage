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

it("reports a refused submission on the floating notice", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mock(async (input: string | URL | Request) =>
		String(input).includes("/presentation-jobs")
			? Response.json(
					{ error: { message: "Presentation generation is not available yet" } },
					{ status: 503 },
				)
			: new Response(null, { status: 500 }),
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

		fireEvent.change(view.getByRole("textbox", { name: "Prompt" }), {
			target: { value: "A deck the API refuses" },
		});
		fireEvent.click(view.getByRole("button", { name: "Generate" }));

		const notice = await view.findByText("Presentation generation is not available yet");
		expect(notice.closest("div")).toHaveClass("fixed", "top-[4.5rem]", "right-4", "text-red-200");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

it("submits the generation job with the retried settings", async () => {
	const originalFetch = globalThis.fetch;
	const fetchMock = mock((input: string | URL | Request, _init?: RequestInit) =>
		String(input).includes("/ai/config")
			? Promise.resolve(
					new Response(
						JSON.stringify({
							generation: {
								mode: "openrouter",
								model: "openrouter/default",
								billing: "points",
							},
							eligibility: {
								eligible: false,
								slideTokens: 10,
								minimumPointsExclusive: 50,
							},
							connections: [],
							models: [],
							selection: null,
						}),
						{ headers: { "Content-Type": "application/json" } },
					),
				)
			: new Promise<Response>(() => {}),
	);
	globalThis.fetch = fetchMock as unknown as typeof fetch;

	try {
		const view = render(
			<MemoryRouter
				initialEntries={[
					{
						pathname: "/generate",
						state: {
							retry: {
								prompt: "Immediate viewer navigation, with launch risks\nand pricing",
								slide_count: 5,
								detail_level: "balanced",
								tonality: "professional",
								research_enabled: false,
								ai: {
									provider: "anthropic",
									model: "claude-sonnet-4-20250514",
								},
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

		fireEvent.click(view.getByRole("button", { name: "Generate" }));

		await waitFor(() =>
			expect(
				fetchMock.mock.calls.some(([input]) => String(input).includes("/presentation-jobs")),
			).toBe(true),
		);
		const generationRequest = fetchMock.mock.calls.find(([input]) =>
			String(input).includes("/presentation-jobs"),
		);
		const requestBody = JSON.parse(
			String((generationRequest?.[1] as RequestInit | undefined)?.body),
		) as Record<string, unknown>;
		expect(requestBody["topic"]).toBe(
			"Immediate viewer navigation, with launch risks\nand pricing",
		);
		expect(requestBody["ai"]).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
		});
		expect(requestBody).not.toHaveProperty("template");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

it("starts generation on Enter even when focus sits on an options-bar control", async () => {
	const originalFetch = globalThis.fetch;
	const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
		if (String(input).includes("/ai/config")) {
			return Response.json({
				generation: { mode: "openrouter", model: "openrouter/default", billing: "points" },
				eligibility: { eligible: true, slideTokens: 100, minimumPointsExclusive: 50 },
				connections: [],
				models: [],
				selection: null,
			});
		}
		if (String(input).includes("/presentation-jobs")) {
			generationBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			return Response.json(
				{ job_id: "job_1", presentation_id: "pres_1", status: "queued" },
				{ status: 202 },
			);
		}
		return new Response('id: 1\nevent: saved\ndata: {"presentation_id":"pres_1"}\n\n', {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		});
	});
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	let generationBody: Record<string, unknown> | undefined;

	try {
		const view = render(
			<MemoryRouter
				initialEntries={[
					{
						pathname: "/generate",
						state: {
							retry: {
								prompt: "Enter submits from anywhere",
								slide_count: 5,
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
						<Route path="/presentations/:presentationId" element={<div>Presentation page</div>} />
					</Routes>
				</StreamingProvider>
			</MemoryRouter>,
		);

		// Generation is gated on the eligibility response, so waiting for the
		// prompt alone can fire Enter while the form is still disabled.
		await waitFor(() => expect(document.getElementById("prompt")).toBeInTheDocument());
		await waitFor(() => expect(view.getByRole("button", { name: "Generate" })).not.toBeDisabled());

		// Focus the slide count slider as if the user had just moved it. The
		// options bar mounts after the eligibility response, so the control has to
		// be awaited rather than queried synchronously.
		const slider = await view.findByRole("slider", { name: "Slide count" });
		fireEvent.focus(slider);
		fireEvent.keyDown(slider, { key: "Enter" });

		// The submit goes through the streaming context and a queued job request,
		// which is slower than the default budget when the whole suite is running.
		await waitFor(() => expect(generationBody?.["topic"]).toBe("Enter submits from anywhere"), {
			timeout: 5000,
		});
		// Once the job is accepted the page moves to the presentation, which
		// shows the rest of the progress.
		expect(await view.findByText("Presentation page")).toBeInTheDocument();
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
	} finally {
		globalThis.fetch = originalFetch;
	}
});

it("keeps a refused retry on the generate page so its error is shown", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mock(async (input: string | URL | Request) =>
		String(input).includes("/presentation-jobs")
			? Response.json(
					{
						error: { message: "Insufficient points", code: "INSUFFICIENT_TOKENS" },
						slide_tokens_remaining: 1,
						slide_tokens_required: 9,
					},
					{ status: 402 },
				)
			: new Response(null, { status: 500 }),
	) as unknown as typeof fetch;

	try {
		const view = render(
			<MemoryRouter
				initialEntries={[
					{
						pathname: "/generate",
						state: {
							retry: {
								prompt: "Retry that cannot be paid for",
								slide_count: 5,
								detail_level: "balanced",
								tonality: "professional",
								research_enabled: false,
							},
							retryPresentationId: "failed_1",
						},
					},
				]}
			>
				<StreamingProvider>
					<Routes>
						<Route path="/generate" element={<GeneratePPTPage />} />
						<Route path="/presentations/:presentationId" element={<div>Presentation page</div>} />
					</Routes>
				</StreamingProvider>
			</MemoryRouter>,
		);

		fireEvent.click(view.getByRole("button", { name: "Generate" }));

		expect(await view.findByText(/Insufficient points\. You have 1\.0 points/)).toBeInTheDocument();
		expect(view.queryByText("Presentation page")).not.toBeInTheDocument();
	} finally {
		globalThis.fetch = originalFetch;
	}
});
