import { Slider, SliderThumb } from "@slidesage/ui/components/slider";
import type React from "react";

/** The API caps a research search at eight results. */
export const MAX_RESEARCH_RESULTS = 8;
export const DEFAULT_RESEARCH_RESULTS = 5;

interface ResearchResultCountSelectorProps {
	resultCount: number;
	onResultCountChange: (count: number) => void;
}

export const ResearchResultCountSelector: React.FC<ResearchResultCountSelectorProps> = ({
	resultCount,
	onResultCountChange,
}) => {
	return (
		<div className="flex items-center gap-3">
			<span className="text-sm font-light whitespace-nowrap text-white/50">Results</span>
			<Slider
				value={[resultCount]}
				min={1}
				max={MAX_RESEARCH_RESULTS}
				step={1}
				className="w-24"
				onValueChange={(values) => onResultCountChange(values[0] ?? DEFAULT_RESEARCH_RESULTS)}
			>
				<SliderThumb aria-label="Research results">{resultCount}</SliderThumb>
			</Slider>
		</div>
	);
};
