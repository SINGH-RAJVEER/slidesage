import {
	CARD_SCHEMA_VERSION,
	type Card,
	type CardDocument,
	DEFAULT_THEME,
	THEMES,
	type ThemeId,
	validateCardDocument,
} from "@slidesage/cards";
import type { DraftPreview, Source } from "@slidesage/types";
import type { CardAsset } from "../Cards/CardView";

/**
 * One slide of the viewer: a card that is written, or the planned point of a
 * card that is still being drafted.
 */
export type ViewerSlide = { key: string; card: Card } | { key: string; takeaway: string };

/** Everything the carousel and thumbnails need to draw a deck. */
export interface ViewerDeck {
	title: string;
	theme: ThemeId;
	slides: ViewerSlide[];
	/** Research sources in the order the drafter numbered them (s1, s2, ...). */
	sources?: Source[];
	/** Stored images the cards show, keyed by asset ID. */
	assets?: Record<string, CardAsset>;
	/** Resolves an asset ID to the URL that serves it. */
	assetUrl?: (assetId: string) => string;
}

export function deckFromDocument(
	document: CardDocument,
	options: Pick<ViewerDeck, "sources" | "assets" | "assetUrl"> = {},
): ViewerDeck {
	return {
		title: document.title,
		theme: document.theme,
		slides: document.cardOrder.flatMap((cardId) => {
			const card = document.cards[cardId];
			return card ? [{ key: cardId, card }] : [];
		}),
		...options,
	};
}

/**
 * The deck as it is drafted. Written cards are checked against the schema as
 * one document before they are shown; if any of them fails, every slot shows
 * its planned point until the saved revision replaces the preview.
 */
export function deckFromPreview(
	preview: DraftPreview,
	assetUrl?: (assetId: string) => string,
	theme?: string,
): ViewerDeck {
	const previewTheme = THEMES.includes(theme as ThemeId) ? (theme as ThemeId) : DEFAULT_THEME;
	const assets = preview.assets as Record<string, CardAsset>;
	const drafted = preview.entries.flatMap((entry) => {
		const card = preview.cards[String(entry.position)];
		return card ? [card as { id: string }] : [];
	});
	const validated =
		drafted.length > 0
			? validateCardDocument(
					{
						schemaVersion: CARD_SCHEMA_VERSION,
						title: preview.title || "Untitled presentation",
						theme: previewTheme,
						cardOrder: drafted.map((card) => card.id),
						cards: Object.fromEntries(drafted.map((card) => [card.id, card])),
					},
					{ knownAssets: new Set(Object.keys(assets)) },
				)
			: null;
	const written = validated?.ok ? validated.value.cards : {};

	return {
		title: preview.title,
		theme: previewTheme,
		slides: preview.entries.map((entry) => {
			const id = (preview.cards[String(entry.position)] as { id?: string } | undefined)?.id;
			const card = id ? written[id] : undefined;
			return card
				? { key: `position-${entry.position}`, card }
				: { key: `position-${entry.position}`, takeaway: entry.takeaway };
		}),
		assets,
		assetUrl,
	};
}
