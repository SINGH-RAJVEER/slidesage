import {
	type Card,
	type CardDocument,
	LAYOUT_RULES,
	normalizeRuns,
	type RichText,
} from "@slidesage/cards";
import { cn } from "@slidesage/ui/lib/utils";
import { Plus, X } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { RichTextEditable } from "./RichTextEditable";
import type { CardTheme } from "./themes";

/**
 * The inline editing pieces every card part shares: a context that is present
 * only while the deck is being edited, text fields that become editors inside
 * it, and the controls that add and remove list items.
 */

/** Applies an edit to the whole document. Present only while editing. */
export type DocumentEdit = (update: (document: CardDocument) => CardDocument) => void;

export const EditContext = createContext<{ edit: DocumentEdit; card: Card } | null>(null);

export function useEditing() {
	return useContext(EditContext);
}

export function RichTextView({ text }: { text: RichText }) {
	return (
		<>
			{text.map((run, index) => {
				const key = `${index}-${run.text}`;
				if (run.bold && run.italic) {
					return (
						<strong key={key}>
							<em>{run.text}</em>
						</strong>
					);
				}
				if (run.bold) return <strong key={key}>{run.text}</strong>;
				if (run.italic) return <em key={key}>{run.text}</em>;
				return <span key={key}>{run.text}</span>;
			})}
		</>
	);
}

/** Rich text that becomes an inline editor while the deck is being edited. */
export function RichField({
	value,
	label,
	update,
}: {
	value: RichText;
	label: string;
	update: (document: CardDocument, value: RichText, cardId: string) => CardDocument;
}) {
	const editing = useEditing();
	if (!editing) return <RichTextView text={value} />;
	const { edit, card } = editing;
	return (
		<RichTextEditable
			value={value}
			label={label}
			onChange={(next) => {
				// Leaving a field re-reads it; unchanged text is not an edit.
				if (JSON.stringify(normalizeRuns(next)) === JSON.stringify(normalizeRuns(value))) return;
				edit((document) => update(document, next, card.id));
			}}
		/>
	);
}

/** Plain text that becomes an inline editor while the deck is being edited. */
export function PlainField({
	value,
	label,
	update,
}: {
	value: string;
	label: string;
	update: (document: CardDocument, value: string, cardId: string) => CardDocument;
}) {
	const editing = useEditing();
	if (!editing) return <>{value}</>;
	const { edit, card } = editing;
	return (
		<RichTextEditable
			plain
			value={[{ text: value }]}
			label={label}
			onChange={(next) => {
				const text = next.map((run) => run.text).join("");
				if (text === value) return;
				edit((document) => update(document, text, card.id));
			}}
		/>
	);
}

/** The card's item bounds, so list controls never break the layout's rules. */
export function itemBounds(card: Card): { min: number; max: number } {
	return LAYOUT_RULES[card.layout].items ?? { min: 1, max: 8 };
}

export function RemoveItem({
	label,
	onRemove,
	visible,
}: {
	label: string;
	onRemove: () => void;
	visible: boolean;
}) {
	if (!visible) return null;
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onRemove}
			className="ml-auto shrink-0 self-start rounded-full p-[calc(0.3cqw*var(--fit,1))] opacity-0 transition-opacity group-hover/item:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
		>
			<X className="size-[calc(1.6cqw*var(--fit,1))]" />
		</button>
	);
}

export function AddItem({
	label,
	onAdd,
	visible,
	theme,
}: {
	label: string;
	onAdd: () => void;
	visible: boolean;
	theme: CardTheme;
}) {
	if (!visible) return null;
	return (
		<button
			type="button"
			onClick={onAdd}
			className={cn(
				"flex w-fit items-center gap-[calc(0.6cqw*var(--fit,1))] rounded-full px-[calc(1cqw*var(--fit,1))] py-[calc(0.4cqw*var(--fit,1))] text-[length:calc(1.3cqw*var(--fit,1))] opacity-60 transition-opacity hover:opacity-100",
				theme.muted,
			)}
		>
			<Plus className="size-[calc(1.4cqw*var(--fit,1))]" />
			{label}
		</button>
	);
}

/** Provides the editing context to one card's content. */
export function CardEditScope({
	edit,
	card,
	children,
}: {
	edit?: DocumentEdit;
	card: Card;
	children: ReactNode;
}) {
	if (!edit) return <>{children}</>;
	return <EditContext.Provider value={{ edit, card }}>{children}</EditContext.Provider>;
}
