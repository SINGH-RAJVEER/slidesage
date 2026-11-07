import { Button } from "@slidesage/ui/components/button";
import { cn } from "@slidesage/ui/lib/utils";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { MAX_CARDS, type OutlineEditor } from "./useOutlineEditor";

/** A field with no box of its own: a surface appears only under the pointer or caret. */
export const QUIET_FIELD =
	"border-transparent bg-transparent text-white shadow-none transition-colors placeholder:text-white/30 hover:bg-white/[0.04] focus-visible:border-white/15 focus-visible:bg-white/[0.06] focus-visible:ring-0 focus-visible:outline-none";

/** Reorder and remove, revealed with the row wherever a pointer can hover. */
export function RowActions({
	index,
	count,
	editor,
	className,
}: {
	index: number;
	count: number;
	editor: Pick<OutlineEditor, "move" | "remove">;
	className?: string;
}) {
	const action = "size-8 text-white/50 hover:bg-white/10 hover:text-white";
	return (
		<div
			data-row-actions
			className={cn(
				"flex shrink-0 items-center transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100",
				className,
			)}
		>
			<Button
				variant="ghost"
				size="icon"
				aria-label={`Move card ${index + 1} up`}
				disabled={index === 0}
				onClick={() => editor.move(index, -1)}
				className={action}
			>
				<ArrowUp className="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label={`Move card ${index + 1} down`}
				disabled={index === count - 1}
				onClick={() => editor.move(index, 1)}
				className={action}
			>
				<ArrowDown className="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label={`Remove card ${index + 1}`}
				disabled={count <= 1}
				onClick={() => editor.remove(index)}
				className="size-8 text-white/50 hover:bg-red-400/10 hover:text-red-200"
			>
				<Trash2 className="size-4" />
			</Button>
		</div>
	);
}

export function AddCardButton({ editor }: { editor: OutlineEditor }) {
	return (
		<Button
			variant="ghost"
			onClick={editor.add}
			disabled={(editor.outline?.cards.length ?? 0) >= MAX_CARDS}
			className="gap-2 font-light text-white/60 hover:bg-white/5 hover:text-white"
		>
			<Plus className="size-4" />
			Add card
		</Button>
	);
}

export function WriteButton({ editor }: { editor: OutlineEditor }) {
	return (
		<Button
			onClick={() => void editor.draft()}
			disabled={!!editor.problem || editor.submitting}
			className="h-10 border border-white/20 bg-white/10 px-5 text-white hover:bg-white/15 disabled:opacity-50"
		>
			{editor.submitting ? "Starting" : `Write ${editor.outline?.cards.length ?? 0} cards`}
		</Button>
	);
}

/** Always in reach, however long the outline grows. */
export function OutlineActionBar({ editor }: { editor: OutlineEditor }) {
	return (
		<div className="shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-xl">
			<div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-3 desktop:px-8">
				<Button
					variant="ghost"
					onClick={editor.back}
					className="-ml-3 gap-2 font-light text-white/60 hover:bg-white/5 hover:text-white"
				>
					<ArrowLeft className="size-4" />
					<span className="mobile:sr-only">
						{editor.request?.researchPayload ? "Back to research" : "Back to generate"}
					</span>
				</Button>
				<span
					role="status"
					className="ml-auto min-w-0 truncate pr-2 text-right text-sm text-amber-200/80"
				>
					{editor.problem}
				</span>
				<WriteButton editor={editor} />
			</div>
		</div>
	);
}
