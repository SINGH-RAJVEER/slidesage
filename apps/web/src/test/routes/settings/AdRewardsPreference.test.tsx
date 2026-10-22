/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";

const authState = { user: { showAdRewards: true } };
const refreshSession = mock(async () => {});
mock.module("@slidesage/ui/context/AuthContext", () => ({
	useAuth: () => ({ user: authState.user, refreshSession }),
}));

const { AdRewardsPreference } = await import("../../../routes/settings/AdRewardsPreference");

it("saves reward visibility and refreshes the session", async () => {
	const originalFetch = globalThis.fetch;
	const bodies: unknown[] = [];
	globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method === "PUT") {
			bodies.push(JSON.parse(String(init.body)));
			authState.user = { showAdRewards: false };
			return Response.json({ user: authState.user });
		}
		return Response.json({ enabled: true });
	}) as unknown as typeof fetch;
	try {
		const view = render(<AdRewardsPreference />);
		fireEvent.click(await view.findByRole("switch", { name: "Offer ads for points" }));
		await waitFor(() => expect(bodies).toEqual([{ showAdRewards: false }]));
		expect(refreshSession).toHaveBeenCalledWith({ force: true });
		expect(await view.findByRole("status")).toHaveTextContent("Ad rewards hidden.");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

it("restores the saved value when an update fails", async () => {
	authState.user = { showAdRewards: true };
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) =>
		init?.method === "PUT"
			? Response.json({ error: { message: "Could not save" } }, { status: 500 })
			: Response.json({ enabled: true }),
	) as unknown as typeof fetch;
	try {
		const view = render(<AdRewardsPreference />);
		fireEvent.click(await view.findByRole("switch", { name: "Offer ads for points" }));
		expect(await view.findByRole("alert")).toHaveTextContent("Could not save");
		expect(view.getByRole("switch")).toBeChecked();
	} finally {
		globalThis.fetch = originalFetch;
	}
});
