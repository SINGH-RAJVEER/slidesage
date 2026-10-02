/// <reference lib="dom" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { ShareDialog } from "../../../routes/presentations/ShareDialog";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function serve(initial: unknown) {
	const calls: string[] = [];
	globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		calls.push(method);
		if (method === "POST") {
			return Response.json(
				{ share: { createdAt: "2026-09-27T10:00:00Z", token: "tok_new" } },
				{ status: 201 },
			);
		}
		if (method === "DELETE") return new Response(null, { status: 204 });
		return Response.json({ share: initial });
	}) as unknown as typeof fetch;
	return calls;
}

describe("ShareDialog", () => {
	it("creates a link and shows it once", async () => {
		const calls = serve(null);
		const view = render(<ShareDialog presentationId="pres_1" open onOpenChange={() => {}} />);

		expect(await view.findByText("This deck is not shared.")).toBeInTheDocument();
		fireEvent.click(view.getByRole("button", { name: "Create link" }));

		const link = await view.findByRole("textbox", { name: "Share link" });
		expect((link as HTMLInputElement).value).toEndWith("/s/tok_new");
		expect(calls).toEqual(["GET", "POST"]);
	});

	it("offers to replace or stop a live link it cannot show again", async () => {
		const calls = serve({ createdAt: "2026-09-27T10:00:00Z" });
		const view = render(<ShareDialog presentationId="pres_1" open onOpenChange={() => {}} />);

		expect(await view.findByText(/A link has been live since/)).toBeInTheDocument();
		expect(view.getByRole("button", { name: "Create a new link" })).toBeInTheDocument();
		fireEvent.click(view.getByRole("button", { name: "Stop sharing" }));

		expect(await view.findByText("This deck is not shared.")).toBeInTheDocument();
		expect(calls).toEqual(["GET", "DELETE"]);
	});
});
