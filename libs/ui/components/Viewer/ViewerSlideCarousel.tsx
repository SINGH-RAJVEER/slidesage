import type { PresentationGenerationStage } from "@slidesage/types";
import { Card } from "@slidesage/ui/components/card";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import type React from "react";
import { citationsFor, type DocumentEdit } from "../Cards/CardView";
import { CARD_THEMES } from "../Cards/themes";
import { CardSlide } from "./CardSlide";
import type { ViewerDeck } from "./deck";
import { GenerationProgress } from "./GenerationProgress";

export interface CarouselGenerationStatus {
	stage?: PresentationGenerationStage;
	message?: string;
	isResearching?: boolean;
}

interface ViewerSlideCarouselProps {
	deck: ViewerDeck | null;
	visibleSlide: number;
	containerRef: React.RefObject<HTMLDivElement | null>;
	onSelectSlide: (index: number) => void;
	isWaitingForFirstSlide?: boolean;
	/** Set while a deck is generating, so the placeholder can report progress. */
	generation?: CarouselGenerationStatus;
	/** Present while editing; only the slide at `editableSlide` takes edits. */
	edit?: DocumentEdit;
	editableSlide?: number;
}

function PendingSlide({
	takeaway,
	generation,
}: {
	takeaway?: string;
	generation?: CarouselGenerationStatus;
}) {
	return (
		<Card className="flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[hsl(222,27%,12%)] shadow-2xl">
			<div className="flex max-w-[70%] flex-col items-center justify-center gap-6 text-center">
				<ThinkingOrb size={64} aria-label="Loading" />
				{takeaway && <p className="text-lg font-light text-white/60">{takeaway}</p>}
				{generation && (
					<GenerationProgress
						stage={generation.stage}
						message={generation.message}
						isResearching={generation.isResearching}
					/>
				)}
			</div>
		</Card>
	);
}

export const ViewerSlideCarousel: React.FC<ViewerSlideCarouselProps> = ({
	deck,
	visibleSlide,
	containerRef,
	onSelectSlide,
	isWaitingForFirstSlide = false,
	generation,
	edit,
	editableSlide,
}) => {
	const theme = deck ? CARD_THEMES[deck.theme] : undefined;
	const citations = citationsFor(deck?.sources ?? []);

	return (
		<div
			className="viewer-slide-area flex-1 mt-3 flex flex-col"
			style={{ maxHeight: "calc(100dvh - 40px - 28px - 48px - 56px)" }}
		>
			<div
				ref={containerRef}
				className="slide-carousel w-full flex-1"
				role="listbox"
				aria-label="Slides carousel"
			>
				{isWaitingForFirstSlide && (
					<div
						id="slide-loading"
						role="option"
						tabIndex={0}
						aria-selected="true"
						aria-label="Waiting for the presentation"
						className="slide-carousel__item"
					>
						<div className="h-full w-full">
							<PendingSlide generation={generation} />
						</div>
					</div>
				)}
				{deck &&
					theme &&
					deck.slides.map((slide, index) => {
						const isActive = visibleSlide === index;

						return (
							// biome-ignore lint/a11y/useKeyWithClickEvents: click only
							// biome-ignore lint/a11y/useFocusableInteractive: mouse-based carousel
							<div
								key={slide.key}
								id={`slide-${index}`}
								role="option"
								aria-selected={isActive}
								className="slide-carousel__item cursor-pointer"
								data-active={isActive}
								onClick={() => onSelectSlide(index)}
							>
								{"card" in slide ? (
									<CardSlide
										card={slide.card}
										theme={theme}
										position={index + 1}
										sources={citations}
										assets={deck.assets}
										assetUrl={deck.assetUrl}
										edit={index === editableSlide ? edit : undefined}
									/>
								) : (
									<PendingSlide takeaway={slide.takeaway} generation={generation} />
								)}
							</div>
						);
					})}
			</div>
		</div>
	);
};
