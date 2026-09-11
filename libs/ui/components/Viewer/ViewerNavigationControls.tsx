import type { PresentationData } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward, Trash2, X } from "lucide-react";
import type React from "react";
import DownloadMenu, { type PresentationExporter } from "./DownloadMenu";

interface ViewerNavigationControlsProps {
	presentation?: PresentationData;
	currentSlide: number;
	totalSlides: number;
	onFirst: () => void;
	onPrev: () => void;
	onNext: () => void;
	onLast: () => void;
	onCancelGeneration?: () => void;
	cancelDisabled?: boolean;
	showDownload?: boolean;
	onExport?: PresentationExporter;
	/** Removes the slide on screen. Omitted where a deck cannot be edited. */
	onDeleteSlide?: () => void;
	deleteDisabled?: boolean;
}

export const ViewerNavigationControls: React.FC<ViewerNavigationControlsProps> = ({
	presentation,
	currentSlide,
	totalSlides,
	onFirst,
	onPrev,
	onNext,
	onLast,
	onCancelGeneration,
	cancelDisabled = false,
	showDownload = true,
	onExport,
	onDeleteSlide,
	deleteDisabled = false,
}) => {
	return (
		<nav
			className="viewer-navigation relative flex items-center mt-3 pt-8 flex-shrink-0"
			aria-label="Slide navigation"
			style={{ minHeight: 36, fontSize: "0.95rem" }}
		>
			{showDownload && presentation && (
				<div className="viewer-navigation__download absolute left-0 top-1/2 -translate-y-1/2">
					<DownloadMenu presentation={presentation} onExport={onExport} />
				</div>
			)}

			<div className="viewer-navigation__pager absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2">
				<Button
					variant="outline"
					onClick={onFirst}
					disabled={totalSlides === 0 || currentSlide === 0}
					aria-label="First slide"
					className="viewer-navigation__edge bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5"
				>
					<SkipBack className="w-4 h-4" />
				</Button>
				<Button
					variant="outline"
					onClick={onPrev}
					disabled={totalSlides === 0 || currentSlide === 0}
					aria-label="Previous slide"
					className="viewer-navigation__previous bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5"
				>
					<ChevronLeft className="w-4 h-4 mr-2" />
					Previous
				</Button>
				<Button
					variant="outline"
					onClick={onNext}
					disabled={totalSlides === 0 || currentSlide === totalSlides - 1}
					aria-label="Next slide"
					className="viewer-navigation__next bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5"
				>
					Next
					<ChevronRight className="w-4 h-4 ml-2" />
				</Button>
				<Button
					variant="outline"
					onClick={onLast}
					disabled={totalSlides === 0 || currentSlide === totalSlides - 1}
					aria-label="Last slide"
					className="viewer-navigation__edge bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5"
				>
					<SkipForward className="w-4 h-4" />
				</Button>
			</div>

			{onCancelGeneration || onDeleteSlide ? (
				<div className="viewer-navigation__delete absolute right-0 top-1/2 flex -translate-y-1/2 gap-2">
					{onCancelGeneration ? (
						<Button
							variant="destructive"
							onClick={onCancelGeneration}
							disabled={cancelDisabled}
							className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 shadow-none transition-all duration-200"
						>
							<X className="w-4 h-4 mr-2" />
							Cancel generation
						</Button>
					) : (
						<Button
							variant="destructive"
							onClick={onDeleteSlide}
							disabled={deleteDisabled || totalSlides <= 1}
							aria-label="Delete slide"
							className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 shadow-none transition-all duration-200"
						>
							<Trash2 className="w-4 h-4 mr-2" />
							Delete
						</Button>
					)}
				</div>
			) : null}
		</nav>
	);
};
