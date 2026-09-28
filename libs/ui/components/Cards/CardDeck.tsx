import type { CardDocument } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { CardToolbar } from "./CardToolbar";
import { type CardAsset, CardView, type DocumentEdit } from "./CardView";
import { CARD_THEMES } from "./themes";

export interface CardDeckProps {
	document: CardDocument;
	/** Research sources in the order the drafter numbered them (s1, s2, ...). */
	sources?: Source[];
	/** Stored images the document shows, keyed by asset ID. */
	assets?: Record<string, CardAsset>;
	/** Resolves an asset ID to the URL that serves it. */
	assetUrl?: (assetId: string) => string;
	/** Present while editing: text becomes editable and each card gets its actions. */
	edit?: DocumentEdit;
	/** Opens the photo picker for a card while editing. */
	onPhoto?: (cardId: string) => void;
	/** Asks AI to revise a card while editing. */
	onRevise?: (cardId: string) => void;
}

/** Maps the drafter's source IDs (s1, s2, ...) to citation numbers and links. */
export function citationsFor(sources: Source[]) {
	return Object.fromEntries(
		sources.map((source, index) => [
			`s${index + 1}`,
			{ number: index + 1, url: source.url, title: source.title },
		]),
	);
}

/** Renders a saved card document in reading order. */
export function CardDeck({
	document,
	sources = [],
	assets,
	assetUrl,
	edit,
	onPhoto,
	onRevise,
}: CardDeckProps) {
	const theme = CARD_THEMES[document.theme];
	const citations = citationsFor(sources);
	return (
		<ol aria-label={document.title} className="flex w-full flex-col gap-8">
			{document.cardOrder.map((cardID, index) => {
				const card = document.cards[cardID];
				if (!card) return null;
				return (
					<li key={cardID}>
						{edit && (
							<CardToolbar
								document={document}
								cardId={cardID}
								edit={edit}
								onPhoto={onPhoto}
								onRevise={onRevise}
							/>
						)}
						<CardView
							card={card}
							theme={theme}
							position={index + 1}
							sources={citations}
							assets={assets}
							assetUrl={assetUrl}
							edit={edit}
						/>
					</li>
				);
			})}
		</ol>
	);
}
