import { describe, expect, it, mock } from "bun:test";
import { MARKETPLACE_ITEMS } from "@slidesage/ui/lib/catalog";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	LANDING_PLATE_COUNT,
	LANDING_POOL_SIZE,
	type LandingPlate,
	landingPlateCount,
	randomLandingPool,
} from "../../../routes/landing/landing-plates";

const RING_LABEL = "Presentation templates orbiting the SlideSage wordmark";

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
		expect(container.querySelectorAll("h1, h2, p")).toHaveLength(0);
	});

	it("renders one rendered slide per plate", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { container } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		const plates = container.querySelectorAll("[data-plate-index] img");
		expect(plates.length).toBe(LANDING_PLATE_COUNT);
		for (const plate of plates) {
			expect(plate.getAttribute("src")).toContain("/template-previews/");
		}
	});

	it("fetches every plate eagerly, since a plate orbits into view whether or not it starts there", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { container } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		for (const image of container.querySelectorAll("[data-plate-index] img")) {
			expect(image.getAttribute("loading")).not.toBe("lazy");
		}
	});

	it("reveals a plate whose image was already cached at mount", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { container } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		/* a cached image is complete before React can attach a load handler, and
		   `load` does not bubble - so if the mount does not catch that case the
		   whole ring stays at zero opacity and is simply not there */
		const image = container.querySelector("[data-plate-index] img") as HTMLImageElement;
		Object.defineProperty(image, "complete", { value: true, configurable: true });
		Object.defineProperty(image, "naturalWidth", { value: 1600, configurable: true });
		fireEvent.load(image);
		/* the reveal waits on decode(), so it lands a microtask later */
		await Promise.resolve();
		await Promise.resolve();

		expect((image.parentElement as HTMLElement).style.opacity).toBe("1");
	});

	it("falls back to the template cover when a slide preview will not load", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { container } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		const plate = container.querySelector('[data-plate-index="0"] img');
		expect(plate).not.toBeNull();

		fireEvent.error(plate as Element);

		expect(plate?.getAttribute("src")).toContain("/template-thumbnails/");
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

		expect(getByRole("dialog")).toBeInTheDocument();

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
	it("draws slides of published sixteen-by-nine templates", () => {
		const pool = randomLandingPool();

		expect(pool).toHaveLength(LANDING_POOL_SIZE);
		for (const plate of pool) {
			expect(plate.slideUrl).toContain(`/template-previews/${plate.templateId}/1/`);
			expect(plate.slideUrl).toMatch(/\/[a-f0-9]{64}\/\d+$/);
			expect(plate.coverUrl).toContain(encodeURIComponent(`pptx-templates/${plate.templateId}/1/`));
			expect(plate.name.length).toBeGreaterThan(0);
		}
	});

	it("draws a surplus, so a plate leaving the ring is refilled with a slide not on it", () => {
		const pool = randomLandingPool();

		expect(pool.length).toBeGreaterThan(LANDING_PLATE_COUNT);
		expect(new Set(pool.map((plate) => plate.key)).size).toBe(pool.length);
	});

	it("opens the ring on content pages, not eight covers", () => {
		/* the opening eight are one slide per template, so a shuffle that could
		   not move slide zero would seat a cover on every plate */
		const opening = Array.from({ length: 20 }, () => randomLandingPool()).flatMap((pool) =>
			pool.slice(0, LANDING_PLATE_COUNT),
		);

		expect(opening.some((plate: LandingPlate) => plate.slideIndex > 0)).toBe(true);
	});

	it("never draws the credits slide every template closes with", () => {
		const pool = randomLandingPool(LANDING_POOL_SIZE * 20);
		const lastSlide = new Map<string, number>();
		for (const plate of pool) {
			lastSlide.set(
				plate.templateId,
				Math.max(lastSlide.get(plate.templateId) ?? 0, plate.slideIndex),
			);
		}

		/* the pool is far larger than the catalog, so every template is drawn
		   to exhaustion: the highest slide it contributes is the last content
		   page, one short of the closing credits */
		expect(lastSlide.size).toBeGreaterThan(0);
		for (const [templateId, highest] of lastSlide) {
			const item = MARKETPLACE_ITEMS.find((candidate) => candidate.id === templateId);
			expect(highest).toBe((item?.slideCount ?? 0) - 2);
		}
	});

	it("spends every template before showing a second page of any of them", () => {
		const eligible = MARKETPLACE_ITEMS.filter(
			(item) => item.available && item.aspectRatio.label === "16:9" && item.slideCount > 1,
		).length;
		const opening = randomLandingPool().slice(0, LANDING_PLATE_COUNT);

		/* the ring holds more plates than the catalog holds templates, so a
		   repeat is unavoidable - but not before every template is on it */
		expect(new Set(opening.map((plate) => plate.templateId)).size).toBe(
			Math.min(LANDING_PLATE_COUNT, eligible),
		);
	});

	it("thins the ring on narrow screens, where the same crowd would be specks", () => {
		expect(landingPlateCount(1440)).toBe(LANDING_PLATE_COUNT);
		expect(landingPlateCount(900)).toBeLessThan(LANDING_PLATE_COUNT);
		expect(landingPlateCount(375)).toBeLessThan(landingPlateCount(900));
		expect(landingPlateCount(375)).toBeGreaterThan(0);
	});

	it("draws a different pool per visit", () => {
		/* a pinned generator proves the order follows the randomiser rather
		   than the catalog's own order */
		let seed = 0;
		const pinned = randomLandingPool(LANDING_POOL_SIZE, () => {
			seed += 0.37;
			return seed % 1;
		});
		const catalogOrder = randomLandingPool(LANDING_POOL_SIZE, () => 0);

		expect(pinned.map((plate) => plate.key)).not.toEqual(catalogOrder.map((plate) => plate.key));
	});
});

describe("EntranceRoute", () => {
	it("shows the landing page to anonymous visitors", async () => {
		authState.isSignedIn = false;
		authState.user = null;
		const { default: EntranceRoute } = await import("../../../app/router/EntranceRoute");

		const { getByRole } = render(
			<MemoryRouter>
				<EntranceRoute />
			</MemoryRouter>,
		);

		expect(getByRole("img", { name: RING_LABEL })).toBeInTheDocument();
	});

	it("keeps a signed-in visitor on the landing page when that is their default", async () => {
		authState.isSignedIn = true;
		authState.user = { landingPage: "landing" };
		const { default: EntranceRoute } = await import("../../../app/router/EntranceRoute");

		const { getByRole } = render(
			<MemoryRouter>
				<EntranceRoute />
			</MemoryRouter>,
		);

		expect(getByRole("img", { name: RING_LABEL })).toBeInTheDocument();
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

		expect(queryByRole("img", { name: RING_LABEL })).not.toBeInTheDocument();
	});
});
