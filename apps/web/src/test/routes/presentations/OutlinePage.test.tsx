/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { StreamingProvider } from "@slidesage/ui";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import OutlinePage from "../../../routes/presentations/OutlinePage";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const outline = {
	plan: {
		title: "Battery storage",
		cards: [
			{ position: 1, takeaway: "Storage is scaling fast", role: "opening", layout: "title" },
			{ position: 2, takeaway: "Costs fell by half", role: "evidence", layout: "stats" },
			{ position: 3, takeaway: "Grids need flexibility", role: "insight", layout: "statement" },
		],
	},
	photos: false,
	slide_tokens_charged: 0.5,
	slide_tokens_remaining: 99.5,
};

function PresentationProbe() {
	const { presentationId } = useParams();
	return <p>Presentation {presentationId}</p>;
}

function renderOutline() {
	return render(
		<MemoryRouter
			initialEntries={[
				{
					pathname: "/generate/outline",
					state: {
						prompt: "Battery storage market",
						slideCount: 3,
						detailLevel: "balanced",
						tonality: "professional",
					},
				},
			]}
		>
			<StreamingProvider>
				<Routes>
					<Route path="/generate/outline" element={<OutlinePage />} />
					<Route path="/presentations/:presentationId" element={<PresentationProbe />} />
				</Routes>
			</StreamingProvider>
		</MemoryRouter>,
	);
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function serve(jobs: Handler) {
	const calls: { url: string; body: Record<string, unknown> }[] = [];
	const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
		calls.push({ url, body });
		if (url.includes("/presentation-outlines")) return Response.json(outline);
		if (url.includes("/presentation-jobs")) return jobs(url, init);
		return new Promise<Response>(() => {});
	});
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return calls;
}

describe("OutlinePage", () => {
	it("asks for the outline once with the route's settings", async () => {
		const calls = serve(() => new Promise<Response>(() => {}));
		const view = renderOutline();

		expect(await view.findByDisplayValue("Battery storage")).toBeInTheDocument();
		const requests = calls.filter((call) => call.url.includes("/presentation-outlines"));
		expect(requests).toHaveLength(1);
		expect(requests[0]?.body).toMatchObject({
			topic: "Battery storage market",
			slide_count: 3,
			detail_level: "balanced",
			tonality: "professional",
			research: { enabled: false },
		});
		expect(typeof requests[0]?.body["outline_id"]).toBe("string");
	});

	it("submits the edited outline as the plan", async () => {
		const calls = serve(() => new Promise<Response>(() => {}));
		const view = renderOutline();

		fireEvent.change(await view.findByLabelText("Card 2 point"), {
			target: { value: "Costs fell by sixty percent" },
		});
		fireEvent.click(view.getByRole("button", { name: "Remove card 3" }));
		fireEvent.click(view.getByRole("button", { name: "Write 2 cards" }));

		await waitFor(() =>
			expect(calls.some((call) => call.url.includes("/presentation-jobs"))).toBe(true),
		);
		const job = calls.find((call) => call.url.includes("/presentation-jobs"));
		expect(job?.body["slide_count"]).toBe(2);
		expect(job?.body["plan"]).toEqual({
			title: "Battery storage",
			cards: [
				{ position: 1, takeaway: "Storage is scaling fast", role: "opening", layout: "title" },
				{ position: 2, takeaway: "Costs fell by sixty percent", role: "evidence", layout: "stats" },
			],
		});
	});

	it("holds the outline back until every card has a point", async () => {
		serve(() => new Promise<Response>(() => {}));
		const view = renderOutline();

		fireEvent.change(await view.findByLabelText("Card 1 point"), { target: { value: " " } });

		expect(view.getByText("Card 1 needs a point.")).toBeInTheDocument();
		expect(view.getByRole("button", { name: "Write 3 cards" })).toBeDisabled();
	});

	it("keeps the outline on screen when the job is refused", async () => {
		serve(() =>
			Response.json(
				{ error: { message: "Presentation generation is not available yet" } },
				{ status: 503 },
			),
		);
		const view = renderOutline();

		fireEvent.click(await view.findByRole("button", { name: "Write 3 cards" }));

		const notice = await view.findByText("Presentation generation is not available yet");
		expect(notice.closest("div")).toHaveClass("fixed");
		expect(view.getByDisplayValue("Battery storage")).toBeInTheDocument();
		expect(view.getByRole("button", { name: "Write 3 cards" })).not.toBeDisabled();
	});

	it("keeps the reason an outline failed on the page", async () => {
		globalThis.fetch = mock(async () =>
			Response.json({ error: { message: "Insufficient points for an outline" } }, { status: 402 }),
		) as unknown as typeof fetch;
		const view = renderOutline();

		const reason = await view.findByRole("alert");
		expect(reason).toHaveTextContent("Insufficient points for an outline");
		expect(reason.closest(".fixed")).toBeNull();
		expect(view.getByRole("button", { name: "Back to generate" })).toBeInTheDocument();
	});

	it("opens the presentation once the job is accepted", async () => {
		serve((url) =>
			url.endsWith("/presentation-jobs")
				? Response.json(
						{ job_id: "job_1", presentation_id: "pres_1", status: "queued" },
						{ status: 202 },
					)
				: new Promise<Response>(() => {}),
		);
		const view = renderOutline();

		fireEvent.click(await view.findByRole("button", { name: "Write 3 cards" }));

		expect(await view.findByText("Presentation pres_1")).toBeInTheDocument();
	});
});
