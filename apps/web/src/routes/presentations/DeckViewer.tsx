import type { DocumentEdit } from "@slidesage/ui/components/Cards";
import { CARD_THEMES, citationsFor } from "@slidesage/ui/components/Cards";
import {
	CardSlide,
	type CarouselGenerationStatus,
	type PresentationExporter,
	type ViewerDeck,
	ViewerFullscreenOverlayControls,
	ViewerHeaderControls,
	ViewerNavigationControls,
	ViewerSlideCarousel,
	ViewerThumbnails,
} from "@slidesage/ui/components/Viewer";
import { useAutoHideControls } from "@slidesage/ui/hooks/useAutoHideControls";
import { useFullscreenMode } from "@slidesage/ui/hooks/useFullscreenMode";
import { usePlayback } from "@slidesage/ui/hooks/usePlayback";
import { useSlideNavigation } from "@slidesage/ui/hooks/useSlideNavigation";
import { useViewerKeyboardNavigation } from "@slidesage/ui/hooks/useViewerKeyboardNavigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface DeckViewerProps {
	title: string;
	/** Null until the deck, or its plan, is known. */
	deck: ViewerDeck | null;
	onBack: () => void;
	backLabel?: string;
	/** Loads where Back goes once the user looks about to press it. */
	onBackPrefetch?: () => void;
	/** Shows the waiting slide in place of a deck that has no slides yet. */
	isWaiting?: boolean;
	/** Set while the deck generates, so waiting slides can report progress. */
	generation?: CarouselGenerationStatus;
	/** Present while editing; only the slide on screen takes edits. */
	edit?: DocumentEdit;
	/** Omitted where a deck cannot be revised, such as a shared deck. */
	iterate?: { canIterate: boolean; onIterate: () => void };
	presentDisabled?: boolean;
	titleEditor?: ReactNode;
	headerTools?: ReactNode;
	headerActions?: ReactNode;
	/** Controls for the slide on screen, shown between the carousel and the navigation. */
	slideControls?: (currentSlide: number) => ReactNode;
	onExport?: PresentationExporter;
	downloadDisabled?: boolean;
	onCancelGeneration?: () => void;
	cancelDisabled?: boolean;
	onDeleteSlide?: (index: number) => void;
	deleteDisabled?: boolean;
	/** Moves the carousel to a slide whenever a new request object is passed. */
	focusRequest?: { index: number };
	/** Reports the slide on screen. */
	onSlideChange?: (index: number) => void;
	/** A panel beside the viewer, such as the iterate sidebar. */
	aside?: ReactNode;
	/** Dialogs and notices the page owns. */
	children?: ReactNode;
}

/**
 * The SlideSage deck viewer: a horizontal carousel of slides with a
 * thumbnail strip that follows it, and a full-screen presentation with
 * timed playback.
 */
export function DeckViewer({
	title,
	deck,
	onBack,
	backLabel,
	onBackPrefetch,
	isWaiting = false,
	generation,
	edit,
	iterate,
	presentDisabled = false,
	titleEditor,
	headerTools,
	headerActions,
	slideControls,
	onExport,
	downloadDisabled,
	onCancelGeneration,
	cancelDisabled,
	onDeleteSlide,
	deleteDisabled,
	focusRequest,
	onSlideChange,
	aside,
	children,
}: DeckViewerProps) {
	const slideContainerRef = useRef<HTMLDivElement | null>(null);
	const slides = deck?.slides ?? [];
	const slideCount = slides.length;
	const navigation = useSlideNavigation({ slideCount, slideContainerRef });
	const hasCards = slideCount > 0 && slides.every((slide) => "card" in slide);

	const { isFullscreenMode, enter: enterFullscreen, exit: exitFullscreen } = useFullscreenMode();
	const { showControls, setShowControls } = useAutoHideControls({
		enabled: isFullscreenMode,
	});

	// Keep controls visible in non-fullscreen mode
	useEffect(() => {
		if (!isFullscreenMode) setShowControls(true);
	}, [isFullscreenMode, setShowControls]);

	const [slideInterval, setSlideInterval] = useState(5);
	const [intervalMode, setIntervalMode] = useState<"preset" | "custom">("preset");
	const [customInterval, setCustomInterval] = useState("5");
	const customInputRef = useRef<HTMLInputElement | null>(null);
	const [notesOpen, setNotesOpen] = useState(false);

	// Focus custom interval input when it appears
	useEffect(() => {
		if (intervalMode === "custom") {
			customInputRef.current?.focus();
		}
	}, [intervalMode]);

	const playback = usePlayback({
		slideCount,
		currentSlide: navigation.currentSlide,
		slideIntervalSeconds: slideInterval,
		onAdvance: (nextIndex) => {
			navigation.scrollToSlide(nextIndex, "smooth");
		},
	});

	useViewerKeyboardNavigation({
		currentSlide: navigation.currentSlide,
		slideCount,
		onNavigate: (index) => navigation.scrollToSlide(index, "auto"),
		onStopPlayback: playback.stop,
	});

	// Show a deck from its first slide once its slides arrive.
	const hadSlides = useRef(false);
	useEffect(() => {
		if (slideCount === 0) {
			hadSlides.current = false;
			return undefined;
		}
		if (hadSlides.current) return undefined;
		hadSlides.current = true;
		const id = setTimeout(() => {
			navigation.scrollToSlide(0, "smooth");
		}, 100);
		return () => clearTimeout(id);
	}, [navigation.scrollToSlide, slideCount]);

	// Each request is acted on once. `scrollToSlide` changes whenever the slide
	// count does, and replaying the last request then would jump to a stale slide.
	const handledFocus = useRef<{ index: number }>(undefined);
	useEffect(() => {
		if (!focusRequest || focusRequest === handledFocus.current) return;
		handledFocus.current = focusRequest;
		navigation.scrollToSlide(focusRequest.index, "smooth");
	}, [focusRequest, navigation.scrollToSlide]);

	useEffect(() => {
		onSlideChange?.(navigation.currentSlide);
	}, [navigation.currentSlide, onSlideChange]);

	// Presenting moves between slides without scrolling the hidden carousel,
	// so it catches up when full screen ends.
	const wasFullscreen = useRef(false);
	useEffect(() => {
		if (wasFullscreen.current && !isFullscreenMode) {
			navigation.scrollToSlide(navigation.currentSlide, "auto");
		}
		wasFullscreen.current = isFullscreenMode;
	}, [isFullscreenMode, navigation.currentSlide, navigation.scrollToSlide]);

	const current = slides[navigation.currentSlide];
	const currentCard = current && "card" in current ? current.card : undefined;

	// N shows the speaker notes while presenting, as it does in PowerPoint.
	useEffect(() => {
		if (!isFullscreenMode) {
			setNotesOpen(false);
			return undefined;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey) return;
			setNotesOpen((open) => !open);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isFullscreenMode]);

	const stopAnd = (move: () => void) => () => {
		playback.stop();
		move();
	};

	return (
		<div className="presentation-viewer flex h-dvh min-h-dvh max-h-dvh bg-transparent p-0">
			<div
				className={
					isFullscreenMode
						? "flex h-dvh w-screen flex-col"
						: "presentation-viewer__shell mx-auto flex h-full min-w-0 w-full max-w-[95vw] flex-1 flex-col pt-3"
				}
			>
				{showControls && !isFullscreenMode && (
					<ViewerHeaderControls
						title={title}
						canIterate={iterate?.canIterate ?? false}
						showIterate={!!iterate}
						onBack={onBack}
						backLabel={backLabel}
						onBackPrefetch={onBackPrefetch}
						onIterate={() => iterate?.onIterate()}
						onPresent={() => void enterFullscreen()}
						presentDisabled={!hasCards || presentDisabled}
						titleEditor={titleEditor}
						tools={headerTools}
						actions={headerActions}
					/>
				)}

				{/* The carousel stays mounted while presenting, so the navigation keeps
				    following its scroll position after full screen ends. */}
				<div className={isFullscreenMode ? "hidden" : "contents"}>
					<ViewerSlideCarousel
						deck={deck}
						visibleSlide={navigation.visibleSlide}
						containerRef={slideContainerRef}
						isWaitingForFirstSlide={isWaiting && slideCount === 0}
						generation={generation}
						edit={edit}
						editableSlide={navigation.currentSlide}
						onSelectSlide={(idx) => {
							if (idx !== navigation.currentSlide) {
								playback.stop();
								navigation.scrollToSlide(idx, "smooth");
							}
						}}
					/>
				</div>

				{!isFullscreenMode && slideControls?.(navigation.currentSlide)}

				{showControls && !isFullscreenMode && (
					<ViewerNavigationControls
						currentSlide={navigation.currentSlide}
						totalSlides={slideCount}
						onFirst={stopAnd(() => navigation.first())}
						onPrev={stopAnd(() => navigation.prev())}
						onNext={stopAnd(() => navigation.next())}
						onLast={stopAnd(() => navigation.last())}
						onCancelGeneration={onCancelGeneration}
						cancelDisabled={cancelDisabled}
						onDeleteSlide={
							onDeleteSlide && hasCards ? () => onDeleteSlide(navigation.currentSlide) : undefined
						}
						deleteDisabled={deleteDisabled}
						onExport={onExport}
						downloadDisabled={downloadDisabled}
					/>
				)}

				{showControls && !isFullscreenMode && (
					<ViewerThumbnails
						deck={deck}
						currentSlide={navigation.currentSlide}
						isStreaming={isWaiting}
						onSelect={(index) => {
							playback.stop();
							navigation.scrollToSlide(index, "smooth", { block: "center" });
						}}
					/>
				)}

				{isFullscreenMode && deck && currentCard && (
					<div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
						<CardSlide
							key={current?.key}
							card={currentCard}
							theme={CARD_THEMES[deck.theme]}
							position={navigation.currentSlide + 1}
							sources={citationsFor(deck.sources ?? [])}
							assets={deck.assets}
							assetUrl={deck.assetUrl}
						/>
						{notesOpen && currentCard.notes && (
							<aside
								aria-label="Speaker notes"
								className="absolute inset-x-0 top-0 max-h-[40%] overflow-y-auto bg-black/80 px-8 py-6 text-lg leading-relaxed text-white/85 backdrop-blur-md"
							>
								{currentCard.notes}
							</aside>
						)}
					</div>
				)}

				{isFullscreenMode && (
					<ViewerFullscreenOverlayControls
						showControls={showControls}
						intervalMode={intervalMode}
						slideInterval={slideInterval}
						customInterval={customInterval}
						customInputRef={customInputRef}
						setIntervalMode={setIntervalMode}
						setSlideInterval={setSlideInterval}
						setCustomInterval={setCustomInterval}
						isPlaying={playback.isPlaying}
						onTogglePlayback={playback.toggle}
						playbackDisabled={slideCount <= 1}
						currentSlide={navigation.currentSlide}
						totalSlides={slideCount}
						onFirst={stopAnd(() => navigation.first())}
						onPrev={stopAnd(() => navigation.prev())}
						onNext={stopAnd(() => navigation.next())}
						onLast={stopAnd(() => navigation.last())}
						onExit={() => void exitFullscreen()}
						onMouseEnter={() => setShowControls(true)}
						notes={
							currentCard?.notes
								? { open: notesOpen, onToggle: () => setNotesOpen((open) => !open) }
								: undefined
						}
					/>
				)}
			</div>
			{!isFullscreenMode && aside}
			{children}
		</div>
	);
}
