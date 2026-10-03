import { type CardTemplate, getCardTemplate } from "@slidesage/cards";
import { deckFromDocument } from "@slidesage/ui/components/Viewer";
import { useMemo } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "../../app/router/paths";
import { useHorizonPageReady } from "../../app/transitions/HorizonTransition";
import { DeckViewer } from "../presentations/DeckViewer";

export default function MarketplaceThemePreviewPage() {
	const { marketplaceId } = useParams();
	const template = getCardTemplate(marketplaceId ?? "");
	if (!template) return <Navigate to={ROUTES.marketplace} replace />;
	return <TemplateViewer key={template.id} template={template} />;
}

function TemplateViewer({ template }: { template: CardTemplate }) {
	useHorizonPageReady(true);
	const navigate = useNavigate();
	const deck = useMemo(
		() =>
			deckFromDocument(template.document, {
				assets: template.assets,
				assetUrl: (id) => template.assets[id]?.url ?? "",
			}),
		[template],
	);
	return (
		<DeckViewer
			title={template.name}
			deck={deck}
			onBack={() => navigate(ROUTES.marketplace)}
			backLabel="Back to marketplace"
		/>
	);
}
