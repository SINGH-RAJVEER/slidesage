import type { CardDocument } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { CardView } from "./CardView";
import { CARD_THEMES } from "./themes";

export interface CardDeckProps {
	document: CardDocument;
	/** Research sources in the order the drafter numbered them (s1, s2, ...). */
	sources?: Source[];
}

/** Renders a saved card document in reading order. */
export function CardDeck({ document, sources = [] }: CardDeckProps) {
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
						<CardView card={card} theme={theme} position={index + 1} sources={citations} />
					</li>
				);
			})}
		</ol>
	);
}
