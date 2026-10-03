import { CARD_TEMPLATES, type Card, type SampleAsset, type ThemeId } from "@slidesage/cards";

/** Real template slides, rendered by the same component as saved presentations. */
export interface LandingPlate {
	key: string;
	deck: string;
	theme: ThemeId;
	card: Card;
	assets: Record<string, SampleAsset>;
	position: number;
}

// Leave room around the photo slides instead of filling every orbit.
export const LANDING_PLATE_COUNT = 24;

export function landingPlateCount(viewportWidth: number): number {
	if (viewportWidth < 640) return 10;
	if (viewportWidth < 1024) return 18;
	return LANDING_PLATE_COUNT;
}

export const LANDING_CARDS: readonly LandingPlate[] = CARD_TEMPLATES.flatMap((template) =>
	template.document.cardOrder.flatMap((cardId, index) => {
		const card = template.document.cards[cardId];
		return card
			? [
					{
						key: cardId,
						deck: template.name,
						theme: template.theme,
						card,
						assets: template.assets,
						position: index + 1,
					},
				]
			: [];
	}),
);

function shuffle<T>(values: T[], random: () => number): T[] {
	for (let index = values.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		const held = values[index];
		const other = values[swap];
		if (held !== undefined && other !== undefined) {
			values[index] = other;
			values[swap] = held;
		}
	}
	return values;
}

/**
 * Draws the plates for one visit.
 *
 * Decks and their cards are shuffled with photo slides first, then taken one card per deck per
 * round. Round-robin rather than a flat shuffle because the opening entries
 * are what the ring shows first: taking a round at a time shows every deck
 * before a second card of any of them, where a flat shuffle would regularly
 * seat three cards of one deck side by side.
 *
 * `random` is injectable so tests can pin the draw.
 */
export function randomLandingPool(random: () => number = Math.random): LandingPlate[] {
	const decks = shuffle(
		CARD_TEMPLATES.map((deck) => {
			const cards = LANDING_CARDS.filter((plate) => plate.deck === deck.name);
			const hasPhoto = (plate: LandingPlate) =>
				plate.card.nodes.some((node) => node.type === "image");
			return [
				...shuffle(cards.filter(hasPhoto), random),
				...shuffle(
					cards.filter((plate) => !hasPhoto(plate)),
					random,
				),
			];
		}),
		random,
	);
	const pool: LandingPlate[] = [];
	for (let round = 0; pool.length < LANDING_CARDS.length; round += 1) {
		for (const deck of decks) {
			const plate = deck[round];
			if (plate) pool.push(plate);
		}
	}
	return pool;
}
