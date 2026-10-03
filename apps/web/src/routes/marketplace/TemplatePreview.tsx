import type { CardTemplate } from "@slidesage/cards";
import { CARD_THEMES, CardView } from "@slidesage/ui/components/Cards";

export function TemplatePreview({
	template,
	cardId = template.previewCardId,
}: {
	template: CardTemplate;
	cardId?: string;
}) {
	const card = template.document.cards[cardId];
	if (!card) return null;
	return (
		<div className="aspect-[16/9] overflow-hidden rounded-lg">
			<CardView
				card={card}
				theme={CARD_THEMES[template.theme]}
				position={template.document.cardOrder.indexOf(cardId) + 1}
				assets={template.assets}
				assetUrl={(id) => template.assets[id]?.url ?? ""}
			/>
		</div>
	);
}
