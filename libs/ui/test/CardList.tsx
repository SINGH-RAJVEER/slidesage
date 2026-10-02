import type { CardDocument } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import {
	CARD_THEMES,
	type CardAsset,
	CardView,
	citationsFor,
	type DocumentEdit,
} from "../components/Cards";

/** Every card of a document, in order, so card rendering can be tested without the viewer. */
export function CardList({
	document,
	sources = [],
	assets,
	assetUrl,
	edit,
}: {
	document: CardDocument;
	sources?: Source[];
	assets?: Record<string, CardAsset>;
	assetUrl?: (assetId: string) => string;
	edit?: DocumentEdit;
}) {
	return document.cardOrder.flatMap((cardId, index) => {
		const card = document.cards[cardId];
		return card
			? [
					<CardView
						key={cardId}
						card={card}
						theme={CARD_THEMES[document.theme]}
						position={index + 1}
						sources={citationsFor(sources)}
						assets={assets}
						assetUrl={assetUrl}
						edit={edit}
					/>,
				]
			: [];
	});
}
