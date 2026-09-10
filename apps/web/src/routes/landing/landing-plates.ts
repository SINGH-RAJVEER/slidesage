import {
	MARKETPLACE_ITEMS,
	type MarketplaceItem,
	presentableSlideCount,
} from "@slidesage/ui/lib/catalog";
import {
	templateSlidePreviewUrl,
	templateThumbnailUrl,
} from "@slidesage/ui/lib/template-thumbnails";

/**
 * A plate orbiting the wordmark. Each one is a single rendered slide of a real
 * published template - a cover, a section divider, or a content page - shown
 * through the same full-slide previews the marketplace viewer reads, so the
 * landing page ships no slide fixtures of its own.
 */
export interface LandingPlate {
	/** Stable identity of this slide, unique across the pool. */
	key: string;
	templateId: string;
	name: string;
	/** Zero-based, in package slide order. */
	slideIndex: number;
	slideUrl: string;
	/**
	 * The template's cover, which every published template has. A slide preview
	 * that will not load falls back to it rather than leaving a hole in the
	 * ring, which also means the page degrades to its old all-covers look if
	 * previews are ever unpublished.
	 */
	coverUrl: string;
}

/**
 * Plates on the ring at once, on a screen wide enough to hold them.
 *
 * Well past what a single ellipse would hold end to end, which is why the hero
 * spreads them into a belt rather than seating them on one line.
 */
export const LANDING_PLATE_COUNT = 30;

/**
 * Plates the ring carries at a given viewport width.
 *
 * The ring's radius scales with the viewport, so a phone's ring is a third the
 * size of a desktop's while a plate stays the same fraction of it. A crowd
 * sized for the desktop belt lands on a phone as a cluster of specks, so the
 * count steps down with the width that has to hold it.
 */
export function landingPlateCount(viewportWidth: number): number {
	if (viewportWidth < 640) return 10;
	if (viewportWidth < 1024) return 18;
	return LANDING_PLATE_COUNT;
}

/**
 * Slides drawn per visit.
 *
 * The ring holds thirty, so the rest are the queue a plate is refilled from as
 * it passes behind the orb. Bounding the draw bounds what the page downloads:
 * one pass through the pool takes a few minutes, after which every image is
 * already in the browser cache and the ring costs nothing to keep turning.
 */
export const LANDING_POOL_SIZE = 72;

type PublishedTemplate = MarketplaceItem & { sha256: string };

/**
 * Templates the ring can draw from: published, wide enough that a 16:9 plate
 * does not letterbox, and carrying at least one slide worth showing.
 */
function ringTemplates(): PublishedTemplate[] {
	return MARKETPLACE_ITEMS.filter(
		(item): item is PublishedTemplate =>
			item.available &&
			item.aspectRatio.label === "16:9" &&
			typeof item.sha256 === "string" &&
			presentableSlideCount(item) > 0,
	);
}

function shuffle<T>(values: T[], random: () => number): T[] {
	for (let index = values.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		const held = values[index];
		const other = values[swap];
		/* an index check, not a truthiness one: slide numbers are shuffled here
		   too, and slide 0 is a perfectly good value that must still move */
		if (held !== undefined && other !== undefined) {
			values[index] = other;
			values[swap] = held;
		}
	}
	return values;
}

function plate(item: PublishedTemplate, slideIndex: number): LandingPlate {
	return {
		key: `${item.id}:${slideIndex}`,
		templateId: item.id,
		name: item.name,
		slideIndex,
		slideUrl: templateSlidePreviewUrl(
			item.id,
			item.templateReference.version,
			item.sha256,
			slideIndex,
		),
		coverUrl: templateThumbnailUrl(item.thumbnailPath),
	};
}

/**
 * Draws the slides for one visit.
 *
 * Templates and their slides are both shuffled, then taken one slide per
 * template per round. Round-robin rather than a flat shuffle because the
 * opening entries are what the ring paints first: taking a round at a time
 * spends every template before it shows a second page of any of them, where a
 * flat shuffle over four hundred odd slides would regularly seat three pages of
 * the same deck side by side - which reads far worse on a crowded ring than on
 * a sparse one.
 *
 * `random` is injectable so tests can pin the draw.
 */
export function randomLandingPool(
	size: number = LANDING_POOL_SIZE,
	random: () => number = Math.random,
): LandingPlate[] {
	const decks = shuffle(ringTemplates(), random).map((item) => ({
		item,
		slides: shuffle(
			Array.from({ length: presentableSlideCount(item) }, (_, index) => index),
			random,
		),
	}));
	const pool: LandingPlate[] = [];
	for (let round = 0; pool.length < size; round += 1) {
		let drew = false;
		for (const deck of decks) {
			if (pool.length >= size) break;
			const slideIndex = deck.slides[round];
			if (slideIndex === undefined) continue;
			drew = true;
			pool.push(plate(deck.item, slideIndex));
		}
		/* every deck is spent: the catalog simply holds fewer slides than asked
		   for, and the ring cycles the shorter pool */
		if (!drew) break;
	}
	return pool;
}
