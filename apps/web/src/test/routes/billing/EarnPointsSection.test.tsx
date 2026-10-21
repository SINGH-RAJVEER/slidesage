/// <reference lib="dom" />

import { afterEach, expect, it, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";

let adOutcome: "granted" | "dismissed" | "unavailable" = "granted";
mock.module("../../../routes/billing/rewarded-ad", () => ({
	showRewardedAd: async (_adUnit: string, beforeShow: () => Promise<void>) => {
		if (adOutcome !== "unavailable") await beforeShow();
		return adOutcome;
	},
}));

const { default: EarnPointsSection } = await import("../../../routes/billing/EarnPointsSection");

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	adOutcome = "granted";
});

const eligible = {
	enabled: true,
	ad_unit: "/1234/rewarded",
	eligible: true,
	reason: null,
	points_per_view: 2,
	views_left_today: 5,
	points_left_this_month: 60,
	next_available_at: null,
	// Zero so the client claims as soon as the ad closes.
	min_watch_seconds: 0,
};

function serve(status: object, early = 0) {
	const requests: string[] = [];
	let tooEarly = early;
	globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		requests.push(`${init?.method ?? "GET"} ${url.slice(url.indexOf("/rewards"))}`);
		if (url.endsWith("/rewards/ads/sessions")) {
			return Response.json(
				{
					session_id: "s1",
					claimable_at: "2000-01-01T00:00:00Z",
					expires_at: "2999-01-01T00:00:00Z",
				},
				{ status: 201 },
			);
		}
		if (url.endsWith("/claim") && tooEarly-- > 0) {
			return Response.json(
				{ error: { message: "Finish watching", code: "AD_REWARD_TOO_EARLY" }, retry_after: 0 },
				{ status: 409 },
			);
		}
		if (url.endsWith("/claim")) return Response.json({ points_awarded: 2, new_balance: 12 });
		return Response.json(status);
	}) as unknown as typeof fetch;
	return requests;
}

it("renders nothing while ad rewards are off", async () => {
	const requests = serve({ enabled: false });
	const view = render(
		<EarnPointsSection onBalance={() => {}} onError={() => {}} onSuccess={() => {}} />,
	);
	await waitFor(() => expect(requests).toEqual(["GET /rewards/ads"]));
	expect(view.container).toBeEmptyDOMElement();
});

it("credits a granted ad and reports the new balance", async () => {
	const requests = serve(eligible);
	const balances: number[] = [];
	const successes: string[] = [];
	const view = render(
		<EarnPointsSection
			onBalance={(balance) => balances.push(balance)}
			onError={() => {}}
			onSuccess={(message) => successes.push(message)}
		/>,
	);
	expect(await view.findByText("5 left today, 60 points left this month")).toBeInTheDocument();
	fireEvent.click(view.getByRole("button", { name: "Watch ad" }));
	await waitFor(() => expect(successes).toEqual(["2 points added to your account!"]));
	expect(balances).toEqual([12]);
	expect(requests.slice(0, 3)).toEqual([
		"GET /rewards/ads",
		"POST /rewards/ads/sessions",
		"POST /rewards/ads/sessions/s1/claim",
	]);
});

it("does not claim an ad closed early", async () => {
	adOutcome = "dismissed";
	const requests = serve(eligible);
	const errors: string[] = [];
	const view = render(
		<EarnPointsSection
			onBalance={() => {}}
			onError={(message) => errors.push(message)}
			onSuccess={() => {}}
		/>,
	);
	fireEvent.click(await view.findByRole("button", { name: "Watch ad" }));
	await waitFor(() => expect(errors).toEqual(["Watch the whole ad to earn points."]));
	expect(requests).not.toContain("POST /rewards/ads/sessions/s1/claim");
});

it("explains why an ineligible user cannot watch", async () => {
	serve({ ...eligible, eligible: false, reason: "email_unverified" });
	const view = render(
		<EarnPointsSection onBalance={() => {}} onError={() => {}} onSuccess={() => {}} />,
	);
	expect(await view.findByText("Verify your email to earn points from ads.")).toBeInTheDocument();
	expect(view.getByRole("button", { name: "Watch ad" })).toBeDisabled();
});

it("retries a claim the server calls early once", async () => {
	const requests = serve(eligible, 1);
	const successes: string[] = [];
	const view = render(
		<EarnPointsSection
			onBalance={() => {}}
			onError={() => {}}
			onSuccess={(message) => successes.push(message)}
		/>,
	);
	fireEvent.click(await view.findByRole("button", { name: "Watch ad" }));
	await waitFor(() => expect(successes).toEqual(["2 points added to your account!"]));
	expect(requests.filter((request) => request.endsWith("/claim"))).toHaveLength(2);
});
