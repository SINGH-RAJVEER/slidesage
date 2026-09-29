import type { CardDocument } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { ChevronLeft, ChevronRight, NotebookText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type CardAsset, CardView, citationsFor } from "./CardView";
import { CARD_THEMES } from "./themes";

export interface PresentModeProps {
	document: CardDocument;
	sources?: Source[];
	assets?: Record<string, CardAsset>;
	assetUrl?: (assetId: string) => string;
	/** Zero-based index of the first card shown. */
	start?: number;
	onExit: () => void;
}

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown", " "]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);

/**
 * Shows one card at a time over the whole screen. Arrow keys, Page Up and
 * Down, and Space move between cards; Home and End jump to either end; N
 * shows the speaker notes; Escape leaves.
 */
export function PresentMode({
	document,
	sources = [],
	assets,
	assetUrl,
	start = 0,
	onExit,
}: PresentModeProps) {
	const count = document.cardOrder.length;
	const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), Math.max(count - 1, 0)));
	const [notesOpen, setNotesOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const exitRef = useRef(onExit);
	exitRef.current = onExit;

	// Full screen is best effort: without it the overlay still covers the page.
	// Leaving full screen through the browser leaves present mode too.
	useEffect(() => {
		const root = rootRef.current;
		const page = window.document;
		root?.focus();
		const overflow = page.body.style.overflow;
		page.body.style.overflow = "hidden";
		let entered = false;
		root
			?.requestFullscreen?.()
			.then(() => {
				entered = true;
			})
			.catch(() => {});
		const onChange = () => {
			if (entered && !page.fullscreenElement) exitRef.current();
		};
		page.addEventListener("fullscreenchange", onChange);
		return () => {
			page.removeEventListener("fullscreenchange", onChange);
			page.body.style.overflow = overflow;
			if (page.fullscreenElement) void page.exitFullscreen().catch(() => {});
		};
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (NEXT_KEYS.has(event.key)) {
				event.preventDefault();
				setIndex((current) => Math.min(current + 1, count - 1));
			} else if (PREVIOUS_KEYS.has(event.key)) {
				event.preventDefault();
				setIndex((current) => Math.max(current - 1, 0));
			} else if (event.key === "Home") {
				event.preventDefault();
				setIndex(0);
			} else if (event.key === "End") {
				event.preventDefault();
				setIndex(count - 1);
			} else if (event.key === "n" || event.key === "N") {
				setNotesOpen((open) => !open);
			} else if (event.key === "Escape") {
				event.preventDefault();
				exitRef.current();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [count]);

	const cardId = document.cardOrder[index];
	const card = cardId ? document.cards[cardId] : undefined;
	const notes = card?.notes?.trim();

	return (
		<div
			ref={rootRef}
			role="dialog"
			aria-modal="true"
			aria-label={`Presenting ${document.title}`}
			tabIndex={-1}
			className="fixed inset-0 z-50 flex flex-col bg-black outline-none"
		>
			{/* Auto margins rather than centering, so a card taller than the
			    screen scrolls from its top instead of being clipped. */}
			<div className="flex min-h-0 flex-1 overflow-y-auto p-6">
				{card && (
					<div className="m-auto w-[min(100%,calc((100dvh-7rem)*16/9))]">
						<CardView
							key={card.id}
							card={card}
							theme={CARD_THEMES[document.theme]}
							position={index + 1}
							sources={citationsFor(sources)}
							assets={assets}
							assetUrl={assetUrl}
						/>
					</div>
				)}
			</div>
			{notesOpen && (
				<section
					aria-label="Speaker notes"
					className="max-h-[30dvh] overflow-y-auto border-t border-white/10 px-8 py-4 text-sm leading-6 whitespace-pre-line text-white/75"
				>
					{notes || "This card has no notes."}
				</section>
			)}
			<nav
				aria-label="Presentation controls"
				className="flex items-center gap-2 border-t border-white/10 px-4 py-2 text-white/60"
			>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Previous card"
					disabled={index === 0}
					onClick={() => setIndex((current) => Math.max(current - 1, 0))}
					className="text-white/70 hover:bg-white/10 hover:text-white"
				>
					<ChevronLeft className="size-5" />
				</Button>
				<span className="min-w-16 text-center text-sm tabular-nums" aria-live="polite">
					{index + 1} / {count}
				</span>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Next card"
					disabled={index >= count - 1}
					onClick={() => setIndex((current) => Math.min(current + 1, count - 1))}
					className="text-white/70 hover:bg-white/10 hover:text-white"
				>
					<ChevronRight className="size-5" />
				</Button>
				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						aria-label={notesOpen ? "Hide speaker notes" : "Show speaker notes"}
						aria-pressed={notesOpen}
						onClick={() => setNotesOpen((open) => !open)}
						className="text-white/70 hover:bg-white/10 hover:text-white"
					>
						<NotebookText className="size-5" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Stop presenting"
						onClick={() => exitRef.current()}
						className="text-white/70 hover:bg-white/10 hover:text-white"
					>
						<X className="size-5" />
					</Button>
				</div>
			</nav>
		</div>
	);
}
