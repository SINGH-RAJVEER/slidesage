import type { CardDocument } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { type CardAsset, CardView } from "./CardView";
import { CARD_THEMES } from "./themes";

export interface CardDeckProps {
	document: CardDocument;
	/** Research sources in the order the drafter numbered them (s1, s2, ...). */
	sources?: Source[];
	/** Stored images the document shows, keyed by asset ID. */
	assets?: Record<string, CardAsset>;
	/** Resolves an asset ID to the URL that serves it. */
	assetUrl?: (assetId: string) => string;
}

/** Renders a saved card document in reading order. */
export function CardDeck({ document, sources = [], assets, assetUrl }: CardDeckProps) {
	const theme = CARD_THEMES[document.theme];
	const citations = Object.fromEntries(
		sources.map((source, index) => [
			`s${index + 1}`,
			{ number: index + 1, url: source.url, title: source.title },
		]),
	);
	return (
		<ol aria-label={document.title} className="flex w-full flex-col gap-8">
			{document.cardOrder.map((cardID, index) => {
				const card = document.cards[cardID];
				if (!card) return null;
				return (
					<li key={cardID}>
						<CardView
							card={card}
							theme={theme}
							position={index + 1}
							sources={citations}
							assets={assets}
							assetUrl={assetUrl}
						/>
					</li>
				);
			})}
		</ol>
	);
}
