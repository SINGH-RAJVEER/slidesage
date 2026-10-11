import type React from "react";
import { DetailLevelSelector } from "./DetailLevelSelector";
import { SlideCountSelector } from "./SlideCountSelector";
import TemplateSelector from "./TemplateSelector";
import { TonalitySelector } from "./TonalitySelector";
import { WebResearchToggle } from "./WebResearchToggle";

interface GenerateOptionsBarProps {
	detailLevel: string;
	tonality: string;
	useWebResearch: boolean;
	/** How many sources a web research search retrieves. */
	researchResultCount: number;
	slideCount: string;
	/** Undefined until the reader picks one; there is no default to assume. */
	selectedTemplateId?: string;
	installedTemplateIds?: string[];
	onDetailLevelChange: (level: string) => void;
	onTonalityChange: (tonality: string) => void;
	onUseWebResearchChange: (enabled: boolean) => void;
	onResearchResultCountChange: (count: number) => void;
	onSlideCountChange: (count: string) => void;
	onTemplateChange: (templateId: string) => void;
	onTemplateRemove?: (templateId: string) => void;
}

export const GenerateOptionsBar: React.FC<GenerateOptionsBarProps> = ({
	detailLevel,
	tonality,
	useWebResearch,
	researchResultCount,
	slideCount,
	selectedTemplateId,
	installedTemplateIds = [],
	onDetailLevelChange,
	onTonalityChange,
	onUseWebResearchChange,
	onResearchResultCountChange,
	onSlideCountChange,
	onTemplateChange,
	onTemplateRemove,
}) => {
	return (
		<div className="mb-2 w-full flex items-center justify-center">
			<div className="flex w-full max-w-full flex-wrap items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-3 sm:w-fit sm:flex-nowrap sm:justify-start sm:gap-3 sm:overflow-x-auto sm:px-4 sm:whitespace-nowrap sm:custom-scrollbar xl:justify-center">
				<WebResearchToggle
					enabled={useWebResearch}
					resultCount={researchResultCount}
					onEnabledChange={onUseWebResearchChange}
					onResultCountChange={onResearchResultCountChange}
				/>

				<TemplateSelector
					selectedTemplateId={selectedTemplateId}
					onTemplateChange={onTemplateChange}
					onTemplateRemove={onTemplateRemove}
					installedTemplateIds={installedTemplateIds}
				/>
				<DetailLevelSelector detailLevel={detailLevel} onDetailLevelChange={onDetailLevelChange} />
				<TonalitySelector tonality={tonality} onTonalityChange={onTonalityChange} />
				<SlideCountSelector slideCount={slideCount} onSlideCountChange={onSlideCountChange} />
			</div>
		</div>
	);
};
