/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

mock.module("@slidesage/ui/context/AuthContext", () => ({
	useAuth: () => ({
		user: null,
		signOut: async () => {},
	}),
}));

const { default: FeedbackPage } = await import("../../../routes/feedback/FeedbackPage");

it("restores feedback drafts when the page is reopened", () => {
	const first = render(
		<MemoryRouter>
			<FeedbackPage />
		</MemoryRouter>,
	);
	fireEvent.change(first.getByLabelText("Your feedback"), {
		target: { value: "My unfinished feedback" },
	});
	first.unmount();
	const restored = render(
		<MemoryRouter>
			<FeedbackPage />
		</MemoryRouter>,
	);
	expect(restored.getByLabelText("Your feedback")).toHaveValue("My unfinished feedback");
});

it("sends trimmed feedback and clears the form", async () => {
	const originalFetch = globalThis.fetch;
	const bodies: string[] = [];
	globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
		bodies.push(String(init?.body));
		return Response.json(
			{ feedback: { id: "feedback-1", created_at: "2026-10-06T00:00:00Z" } },
			{ status: 201 },
		);
	}) as unknown as typeof fetch;

	try {
		const view = render(
			<MemoryRouter>
				<FeedbackPage />
			</MemoryRouter>,
		);
		const send = view.getByRole("button", { name: "Send feedback" });
		expect(send).toBeDisabled();

		const field = view.getByLabelText("Your feedback");
		fireEvent.change(field, { target: { value: "  More themes please  " } });
		fireEvent.click(send);

		expect(await view.findByRole("status")).toHaveTextContent("Thanks, your feedback was sent");
		expect(bodies.map((body) => JSON.parse(body))).toEqual([{ message: "More themes please" }]);
		await waitFor(() => expect(field).toHaveValue(""));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

it("keeps the draft and shows the API error when sending fails", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mock(async () =>
		Response.json({ error: { message: "Too many requests" } }, { status: 429 }),
	) as unknown as typeof fetch;

	try {
		const view = render(
			<MemoryRouter>
				<FeedbackPage />
			</MemoryRouter>,
		);
		const field = view.getByLabelText("Your feedback");
		fireEvent.change(field, { target: { value: "Export to Keynote" } });
		fireEvent.click(view.getByRole("button", { name: "Send feedback" }));

		expect(await view.findByRole("alert")).toHaveTextContent("Too many requests");
		expect(field).toHaveValue("Export to Keynote");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
