import {
	addCard,
	addWidget,
	type CardDocument,
	canAddImage,
	canAddWidget,
	compatibleLayouts,
	duplicateCard,
	type LayoutId,
	moveCard,
	newWidgetCard,
	removeImage,
	setLayout,
	WIDGET_TYPES,
} from "@slidesage/cards";
import { Button } from "@slidesage/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@slidesage/ui/components/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@slidesage/ui/components/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@slidesage/ui/components/tooltip";
import {
	ArrowLeft,
	ArrowRight,
	ChartColumn,
	Copy,
	ImageMinus,
	ImagePlus,
	Plus,
	Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DocumentEdit } from "./fields";
import { WIDGET_NAMES } from "./WidgetControls";

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
	chart: "Chart",
	table: "Table",
	dashboard: "Dashboard",
};

const WIDGET_CARDS = [
	{ layout: "chart", label: "Chart card" },
	{ layout: "table", label: "Table card" },
	{ layout: "dashboard", label: "Dashboard card" },
] as const;

/**
 * Adds a widget to this card, moving it to a layout that holds the widget
 * beside its content, or adds a new card built around widgets.
 */
function InsertMenu({
	document,
	cardId,
	edit,
}: Pick<CardToolbarProps, "document" | "cardId" | "edit">) {
	const card = document.cards[cardId];
	if (!card) return null;
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Insert a widget"
							className="size-8 text-white/60 hover:bg-white/10 hover:text-white"
						>
							<ChartColumn className="size-4" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Insert a widget</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Add to this card</DropdownMenuLabel>
				{WIDGET_TYPES.map((type) => (
					<DropdownMenuItem
						key={type}
						disabled={!canAddWidget(card, type)}
						onSelect={() => edit((current) => addWidget(current, cardId, type))}
					>
						{WIDGET_NAMES[type]}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuLabel>New card after this one</DropdownMenuLabel>
				{WIDGET_CARDS.map(({ layout, label }) => (
					<DropdownMenuItem
						key={layout}
						onSelect={() => edit((current) => addCard(current, cardId, newWidgetCard(layout)))}
					>
						{label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

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
 * Actions for the card on screen while editing. It sits beside the carousel
 * rather than on the card, so the card surface shows only its own content.
 * Deleting a card is the viewer's Delete, which asks first.
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
			className="flex items-center gap-1"
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
				<InsertMenu document={document} cardId={cardId} edit={edit} />
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
					label="Move card left"
					disabled={index === 0}
					onClick={() => edit((current) => moveCard(current, cardId, -1))}
				>
					<ArrowLeft className="size-4" />
				</Action>
				<Action
					label="Move card right"
					disabled={index === document.cardOrder.length - 1}
					onClick={() => edit((current) => moveCard(current, cardId, 1))}
				>
					<ArrowRight className="size-4" />
				</Action>
				<Action
					label="Duplicate card"
					onClick={() => edit((current) => duplicateCard(current, cardId))}
				>
					<Copy className="size-4" />
				</Action>
				<Action label="Add card after" onClick={() => edit((current) => addCard(current, cardId))}>
					<Plus className="size-4" />
				</Action>
			</div>
		</div>
	);
}
