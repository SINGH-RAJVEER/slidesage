import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import type React from "react";
import { useEffect, useRef } from "react";
import type { ViewerDocument } from "../../lib/viewer-document";
import { PreviewSlide } from "./PreviewSlide";

export const ViewerThumbnails: React.FC<{
	document: ViewerDocument | null;
	currentSlide: number;
	isStreamingMode: boolean;
	isStreaming: boolean;
	onSelect: (index: number) => void;
}> = ({ document, currentSlide, isStreamingMode, isStreaming, onSelect }) => {
	const slideCount = document?.slideCount ?? 0;
	const thumbnailContainerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = thumbnailContainerRef.current;
		const currentThumbnail = container?.querySelector<HTMLElement>(
			`[data-slide-index="${currentSlide}"]`,
		);
		if (!container || !currentThumbnail) return;

		const containerRect = container.getBoundingClientRect();
		const thumbnailRect = currentThumbnail.getBoundingClientRect();
		const left =
			container.scrollLeft +
			thumbnailRect.left -
			containerRect.left -
			(containerRect.width - thumbnailRect.width) / 2;
		container.scrollTo({
			left,
			behavior: "smooth",
		});
	}, [currentSlide, slideCount]);

	return (
		<div
			className="viewer-thumbnails w-full overflow-hidden flex-shrink-0 relative"
			style={{ minHeight: 40 }}
		>
			<div
				ref={thumbnailContainerRef}
				className="slide-thumbnails-container flex gap-3 overflow-x-auto py-6 px-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
			>
				{document &&
					Array.from({ length: slideCount }, (_, index) => {
						const isFirstThumbnail = index === 0;
						const isLastThumbnail = index === slideCount - 1 && !(isStreamingMode && isStreaming);

						return (
							<button
								key={index}
								type="button"
								data-slide-index={index}
								aria-label={`Go to slide ${index + 1}`}
								onClick={() => onSelect(index)}
								style={{
									marginLeft: isFirstThumbnail ? "calc(50% - 64px)" : "0",
									marginRight: isLastThumbnail ? "calc(50% - 64px)" : "0",
								}}
								className={`w-32 h-[4.5rem] border-2 rounded-lg flex-shrink-0 transition-all duration-300 overflow-hidden
                ${
									currentSlide === index
										? "border-blue-500 bg-blue-500/20 shadow-lg shadow-blue-500/50"
										: "border-white/20 bg-white/10 hover:border-white/40 hover:bg-white/20"
								}
                backdrop-blur-sm relative`}
							>
								<div className="relative h-full w-full bg-white">
									<PreviewSlide document={document} index={index} className="w-full" />
									<span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
										{index + 1}
									</span>
								</div>
							</button>
						);
					})}

				{isStreamingMode && isStreaming && (
					<div
						style={{ marginRight: "calc(50% - 64px)" }}
						className="w-32 h-[4.5rem] border-2 border-dashed border-blue-400/50 rounded-lg flex-shrink-0 overflow-hidden backdrop-blur-sm bg-blue-500/10 flex items-center justify-center"
					>
						<ThinkingOrb size={20} />
					</div>
				)}
			</div>
		</div>
	);
};
