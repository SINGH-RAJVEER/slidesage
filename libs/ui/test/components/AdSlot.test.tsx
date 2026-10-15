import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { AdLinkProps } from "@slidesage/ui/components/AdSlot";
import type { User } from "@slidesage/ui/context/AuthContext";
import { act, render, waitFor } from "@testing-library/react";

const mockAuthState: { user: User | null; loading: boolean } = { user: null, loading: true };
const requestAd = mock(() => {});
const actualAds = await import("@slidesage/ui/lib/ads");

mock.module("@slidesage/ui/context/AuthContext", () => ({ useAuth: () => mockAuthState }));
// The real loader would fetch adsbygoogle.js; these tests answer for AdSense instead.
mock.module("@slidesage/ui/lib/ads", () => ({
	...actualAds,
	loadAdScript: () => Promise.resolve(),
	requestAd,
}));

const { AdSlot } = await import("@slidesage/ui/components/AdSlot");

// happy-dom holds each MutationObserver callback through a WeakRef, so a garbage
// collection while a slot waits can silently drop its observer. The tests hand
// AdSense's answer to the slot's observers themselves.
const RealMutationObserver = globalThis.MutationObserver;
const observers = new Set<FakeMutationObserver>();
class FakeMutationObserver {
	readonly callback: MutationCallback;
	constructor(callback: MutationCallback) {
		this.callback = callback;
	}
	observe() {
		observers.add(this);
	}
	disconnect() {
		observers.delete(this);
	}
	takeRecords() {
		return [];
	}
}
beforeAll(() => {
	globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver;
});
afterAll(() => {
	globalThis.MutationObserver = RealMutationObserver;
});

const config = { clientId: "ca-pub-1234567890123456", slots: { generate: "1234567890" } };
const Link = ({ to, className, children }: AdLinkProps) => (
	<a href={to} className={className}>
		{children}
	</a>
);

function renderSlot(props: { config?: typeof config | null; answerTimeoutMs?: number } = {}) {
	return render(
		<AdSlot
			placement="generate"
			height={90}
			maxWidth={728}
			purchaseHref="/purchase"
			LinkComponent={Link}
			config={config}
			{...props}
		/>,
	);
}

function signInBelowThreshold() {
	mockAuthState.loading = false;
	mockAuthState.user = { id: "u1", email: "reader@example.com", slideTokens: 50 } as User;
}

/** Answers like AdSense: marks the unit, then notifies the slot's observers. */
async function answer(container: HTMLElement, status: "filled" | "unfilled") {
	await waitFor(() => expect(requestAd).toHaveBeenCalled());
	await act(async () => {
		container.querySelector("ins.adsbygoogle")?.setAttribute("data-ad-status", status);
		for (const observer of observers) {
			observer.callback([], observer as unknown as MutationObserver);
		}
	});
}

describe("AdSlot", () => {
	it("renders nothing when ads are not configured", () => {
		signInBelowThreshold();
		const { container } = renderSlot({ config: null });

		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing before the session says the reader sees ads", () => {
		mockAuthState.loading = true;
		mockAuthState.user = null;
		const { container } = renderSlot();

		expect(container).toBeEmptyDOMElement();
	});

	it("stays hidden until AdSense delivers an ad, then shows it with its label", async () => {
		signInBelowThreshold();
		requestAd.mockClear();
		const { container, getByText } = renderSlot();
		const slot = container.querySelector("aside");

		expect(slot).toHaveAttribute("aria-hidden", "true");
		expect(slot).toHaveAttribute("inert");

		await answer(container, "filled");

		expect(slot).not.toHaveAttribute("aria-hidden");
		expect(slot).not.toHaveAttribute("inert");
		expect(getByText("Remove ads")).toHaveAttribute("href", "/purchase");
	});

	it("removes itself when AdSense has no ad", async () => {
		signInBelowThreshold();
		requestAd.mockClear();
		const { container } = renderSlot();

		await answer(container, "unfilled");

		expect(container).toBeEmptyDOMElement();
	});

	it("removes itself when AdSense never answers", async () => {
		signInBelowThreshold();
		const { container } = renderSlot({ answerTimeoutMs: 20 });

		await waitFor(() => expect(container).toBeEmptyDOMElement());
	});
});
