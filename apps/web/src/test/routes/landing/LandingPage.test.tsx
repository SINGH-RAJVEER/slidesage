import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	LANDING_CARDS,
	LANDING_PLATE_COUNT,
	landingPlateCount,
	randomLandingPool,
} from "../../../routes/landing/landing-plates";
import {
	accelerateRing,
	decelerateRing,
	plateStackingLayers,
} from "../../../routes/landing/SlideRingHero";

const RING_LABEL = "Presentation slides orbiting a black hole";

const authState: { isSignedIn: boolean; loading: boolean; user: { landingPage?: string } | null } =
	{
		isSignedIn: false,
		loading: false,
		user: null,
	};

mock.module("@slidesage/ui", () => ({
	useAuth: () => authState,
	LoadingScreen: ({ label }: { label: string }) => <div>{label}</div>,
}));

describe("LandingPage", () => {
	it("renders only the ring hero, with no header or copy sections", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { getByRole, queryByRole, container } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		expect(getByRole("img", { name: RING_LABEL })).toBeInTheDocument();
		expect(queryByRole("banner")).not.toBeInTheDocument();
		expect(queryByRole("contentinfo")).not.toBeInTheDocument();
		/* the sphere is the page's single call to action */
		expect(getByRole("link", { name: "SlideSage — sign up" })).toHaveAttribute("href", "/sign-up");
		/* the plates carry cards, which are pictures here rather than copy */
		const copy = Array.from(container.querySelectorAll("h1, h2, p")).filter(
			(element) => !element.closest("[data-plate-index]"),
		);
		expect(copy).toHaveLength(0);
	});

	it("draws a card on every plate of the ring", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { container } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		const plates = container.querySelectorAll("[data-plate-index]");
		expect(plates.length).toBe(LANDING_PLATE_COUNT);
		for (const plate of plates) {
			expect(plate.querySelector("article[data-card-id]")).not.toBeNull();
		}
	});

	it("opens a hovering preview when a plate is clicked, and closes on Escape", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { getByRole, queryByRole } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		const plate = document.querySelector('[data-plate-index="0"]');
		expect(plate).not.toBeNull();

		fireEvent.pointerDown(plate as Element, { clientX: 100, clientY: 100 });
		fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });

		/* the preview draws the plate's card again, at full size */
		const plateCard = (plate as Element).querySelector("article")?.getAttribute("data-card-id");
		expect(getByRole("dialog").querySelector("article")?.getAttribute("data-card-id")).toBe(
			plateCard ?? "",
		);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("throws the ring on drag without opening the preview", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { queryByRole } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		const plate = document.querySelector('[data-plate-index="0"]');
		expect(plate).not.toBeNull();

		fireEvent.pointerDown(plate as Element, { clientX: 100, clientY: 100 });
		fireEvent.pointerMove(window, { clientX: 160, clientY: 100 });
		fireEvent.pointerMove(window, { clientX: 220, clientY: 100 });
		fireEvent.pointerUp(window, { clientX: 220, clientY: 100 });

		/* a throw, not a tap: the ring spins on and no preview opens */
		expect(queryByRole("dialog")).not.toBeInTheDocument();
	});
});

describe("Landing plates", () => {
	it("adds momentum on repeated throws and then loses it gradually", () => {
		const firstThrow = accelerateRing(0, 1);
		const secondThrow = accelerateRing(firstThrow, 1);
		const coasting = decelerateRing(secondThrow, 1);

		expect(secondThrow).toBeGreaterThan(firstThrow);
		expect(coasting).toBeLessThan(secondThrow);
		expect(coasting).toBeGreaterThan(0);
	});

	it("reuses the caller's scratch buffers, so a frame allocates nothing", () => {
		const order: number[] = [];
		const layers: number[] = [];

		const first = plateStackingLayers([{ depth: 0.4 }, { depth: 0.1 }], order, layers);
		const second = plateStackingLayers([{ depth: 0.1 }, { depth: 0.4 }], order, layers);

		expect(first).toBe(layers);
		expect(second).toBe(layers);
		expect(Array.from(second)).toEqual([0, 1]);
	});

	it("keeps every distinct depth on its own stacking layer", () => {
		const layers = plateStackingLayers([{ depth: 0.511 }, { depth: 0.512 }]);

		expect(layers[1]).toBeGreaterThan(layers[0] ?? 0);
	});

	it("draws every sample card once, with a surplus to refill the ring from", () => {
		const pool = randomLandingPool();

		expect(pool.length).toBe(LANDING_CARDS.length);
		expect(pool.length).toBeGreaterThan(LANDING_PLATE_COUNT);
		expect(new Set(pool.map((plate) => plate.key)).size).toBe(pool.length);
	});

	it("shows every deck and theme before a second card of any deck", () => {
		const decks = new Set(LANDING_CARDS.map((plate) => plate.deck));
		const opening = randomLandingPool().slice(0, decks.size);

		expect(new Set(opening.map((plate) => plate.deck)).size).toBe(decks.size);
		expect(new Set(opening.map((plate) => plate.theme))).toEqual(
			new Set(["slate", "paper", "ember"]),
		);
	});

	it("shows the range of layouts a generated deck uses", () => {
		/* every sample already passed the converter when LANDING_CARDS was built */
		const layouts = new Set(LANDING_CARDS.map((plate) => plate.card.layout));
		expect(layouts.has("stats")).toBe(true);
		expect(layouts.has("process")).toBe(true);
		expect(layouts.has("comparison")).toBe(true);
	});

	it("thins the ring on narrow screens, where the same crowd would be specks", () => {
		expect(landingPlateCount(1440)).toBe(LANDING_PLATE_COUNT);
		expect(landingPlateCount(900)).toBeLessThan(LANDING_PLATE_COUNT);
		expect(landingPlateCount(375)).toBeLessThan(landingPlateCount(900));
		expect(landingPlateCount(375)).toBeGreaterThan(0);
	});

	it("draws a different pool per visit", () => {
		/* a pinned generator proves the order follows the randomiser rather
		   than the samples' own order */
		let seed = 0;
		const pinned = randomLandingPool(() => {
			seed += 0.37;
			return seed % 1;
		});
		const catalogOrder = randomLandingPool(() => 0);

		expect(pinned.map((plate) => plate.key)).not.toEqual(catalogOrder.map((plate) => plate.key));
	});
});

describe("Reduced motion", () => {
	it("holds the ring still instead of running a frame loop over it", async () => {
		const originalMatchMedia = window.matchMedia;
		const originalFrame = window.requestAnimationFrame;
		let scheduled = 0;
		window.matchMedia = ((query: string) => ({
			matches: query.includes("prefers-reduced-motion"),
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		})) as unknown as typeof window.matchMedia;
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			scheduled += 1;
			return originalFrame(callback);
		}) as typeof window.requestAnimationFrame;

		try {
			const { default: LandingPage } = await import("../../../routes/landing/LandingPage");
			const { container } = render(
				<MemoryRouter>
					<LandingPage />
				</MemoryRouter>,
			);

			/* the belt is laid out, but nothing is animating it: the old loop
			   rewrote thirty plates a frame with the values they already held */
			expect(container.querySelectorAll("[data-plate-index]").length).toBe(LANDING_PLATE_COUNT);
			expect(scheduled).toBe(0);
		} finally {
			window.matchMedia = originalMatchMedia;
			window.requestAnimationFrame = originalFrame;
		}
	});
});

describe("EntranceRoute", () => {
	it("shows the landing page to anonymous visitors", async () => {
		authState.isSignedIn = false;
		authState.user = null;
		const { default: EntranceRoute } = await import("../../../app/router/EntranceRoute");

		const { findByRole } = render(
			<MemoryRouter>
				<EntranceRoute />
			</MemoryRouter>,
		);

		/* the landing page is split out of the initial bundle, so it arrives a
		   chunk later rather than in the first render */
		expect(await findByRole("img", { name: RING_LABEL })).toBeInTheDocument();
	});

	it("keeps a signed-in visitor on the landing page when that is their default", async () => {
		authState.isSignedIn = true;
		authState.user = { landingPage: "landing" };
		const { default: EntranceRoute } = await import("../../../app/router/EntranceRoute");

		const { findByRole } = render(
			<MemoryRouter>
				<EntranceRoute />
			</MemoryRouter>,
		);

		/* the landing page is split out of the initial bundle, so it arrives a
		   chunk later rather than in the first render */
		expect(await findByRole("img", { name: RING_LABEL })).toBeInTheDocument();
	});

	it("forwards a signed-in visitor whose default is an app page", async () => {
		authState.isSignedIn = true;
		authState.user = { landingPage: "generate" };
		const { default: EntranceRoute } = await import("../../../app/router/EntranceRoute");

		const { queryByRole } = render(
			<MemoryRouter>
				<EntranceRoute />
			</MemoryRouter>,
		);

		await act(async () => {});
		expect(queryByRole("img", { name: RING_LABEL })).not.toBeInTheDocument();
	});
});
