import {
	addCard,
	type CardDocument,
	canAddImage,
	compatibleLayouts,
	deleteCard,
	duplicateCard,
	type LayoutId,
	moveCard,
	removeImage,
	setLayout,
} from "@slidesage/cards";
import { Button } from "@slidesage/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@slidesage/ui/components/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@slidesage/ui/components/tooltip";
import {
	ArrowDown,
	ArrowUp,
	Copy,
	ImageMinus,
	ImagePlus,
	Plus,
	Sparkles,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DocumentEdit } from "./CardView";

export const LAYOUT_NAMES: Record<LayoutId, string> = {
	title: "Title",
	statement: "Statement",
	bullets: "Bullets",
	comparison: "Comparison",
	process: "Process",
	quote: "Quote",
	stats: "Figures",
	"image-left": "Photo left",
	"image-right": "Photo right",
	cover: "Photo cover",
};

function Action({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={label}
					disabled={disabled}
					onClick={onClick}
					className="size-8 text-white/60 hover:bg-white/10 hover:text-white"
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

export interface CardToolbarProps {
	document: CardDocument;
	cardId: string;
	edit: DocumentEdit;
	/** Opens the photo picker for this card. */
	onPhoto?: (cardId: string) => void;
	/** Asks AI to revise this card. */
	onRevise?: (cardId: string) => void;
}

/**
 * Actions for one card while editing. It sits above the card rather than on
 * it, so the card surface shows only the card's own content.
 */
export function CardToolbar({ document, cardId, edit, onPhoto, onRevise }: CardToolbarProps) {
	const card = document.cards[cardId];
	const index = document.cardOrder.indexOf(cardId);
	if (!card) return null;
	const layouts = compatibleLayouts(card);
	const hasImage = card.nodes.some((node) => node.type === "image");

	return (
		<div
			role="toolbar"
			aria-label={`Card ${index + 1} actions`}
			className="flex items-center gap-1 pb-2"
		>
			<Select
				value={card.layout}
				onValueChange={(layout) =>
					edit((current) => setLayout(current, cardId, layout as LayoutId))
				}
			>
				<SelectTrigger
					aria-label="Card layout"
					className="h-8 w-40 border-white/10 bg-transparent text-xs text-white/70"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{layouts.map((layout) => (
						<SelectItem key={layout} value={layout}>
							{LAYOUT_NAMES[layout]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<div className="ml-auto flex items-center gap-1">
				{onRevise && (
					<Action label="Revise this card with AI" onClick={() => onRevise(cardId)}>
						<Sparkles className="size-4" />
					</Action>
				)}
				{onPhoto && (
					<Action
						label={
							hasImage
								? "Replace photo"
								: canAddImage(card)
									? "Add photo"
									: "This card has too much text for a photo"
						}
						disabled={!hasImage && !canAddImage(card)}
						onClick={() => onPhoto(cardId)}
					>
						<ImagePlus className="size-4" />
					</Action>
				)}
				{hasImage && (
					<Action
						label="Remove photo"
						onClick={() => edit((current) => removeImage(current, cardId))}
					>
						<ImageMinus className="size-4" />
					</Action>
				)}
				<Action
					label="Move card up"
					disabled={index === 0}
					onClick={() => edit((current) => moveCard(current, cardId, -1))}
				>
					<ArrowUp className="size-4" />
				</Action>
				<Action
					label="Move card down"
					disabled={index === document.cardOrder.length - 1}
					onClick={() => edit((current) => moveCard(current, cardId, 1))}
				>
					<ArrowDown className="size-4" />
				</Action>
				<Action
					label="Duplicate card"
					onClick={() => edit((current) => duplicateCard(current, cardId))}
				>
					<Copy className="size-4" />
				</Action>
				<Action label="Add card below" onClick={() => edit((current) => addCard(current, cardId))}>
					<Plus className="size-4" />
				</Action>
				<Action
					label="Delete card"
					disabled={document.cardOrder.length <= 1}
					onClick={() => edit((current) => deleteCard(current, cardId))}
				>
					<Trash2 className="size-4" />
				</Action>
			</div>
		</div>
	);
}
