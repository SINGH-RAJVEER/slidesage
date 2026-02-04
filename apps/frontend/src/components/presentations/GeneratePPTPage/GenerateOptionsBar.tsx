import { Globe } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { DetailLevelSelector } from "./DetailLevelSelector";
import { SlideCountSelector } from "./SlideCountSelector";
import { TonalitySelector } from "./TonalitySelector";

interface GenerateOptionsBarProps {
	detailLevel: string;
	tonality: string;
	useWebResearch: boolean;
	slideCountMode: string;
	slideCount: string;
	customSlideCount: string;
	onDetailLevelChange: (level: string) => void;
	onTonalityChange: (tonality: string) => void;
	onUseWebResearchChange: (enabled: boolean) => void;
	onSlideCountModeChange: (mode: string) => void;
	onSlideCountChange: (count: string) => void;
	onCustomSlideCountChange: (count: string) => void;
}

export const GenerateOptionsBar: React.FC<GenerateOptionsBarProps> = ({
	detailLevel,
	tonality,
	useWebResearch,
	slideCountMode,
	slideCount,
	customSlideCount,
	onDetailLevelChange,
	onTonalityChange,
	onUseWebResearchChange,
	onSlideCountModeChange,
	onSlideCountChange,
	onCustomSlideCountChange,
}) => {
	return (
		<div className="absolute top-0 right-0 left-0 -mt-20 flex items-center justify-center px-4">
			<div className="flex items-center gap-8 bg-black/20 backdrop-blur-xl rounded-full px-10 py-4 border border-white/5">
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={() => onUseWebResearchChange(!useWebResearch)}
						className={`h-12 px-6 rounded-full transition-all duration-300 border ${
							useWebResearch
								? "bg-white/20 text-white border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
								: "bg-transparent text-white/50 border-transparent hover:text-white hover:bg-white/5"
						}`}
					>
						<span className="flex items-center gap-3 text-base font-light">
							<Globe className="h-5 w-5" />
							Web Research
						</span>
					</Button>
				</div>

				<div className="w-px h-8 bg-white/10" />

				<DetailLevelSelector
					detailLevel={detailLevel}
					onDetailLevelChange={onDetailLevelChange}
				/>
				<TonalitySelector
					tonality={tonality}
					onTonalityChange={onTonalityChange}
				/>
				<SlideCountSelector
					slideCountMode={slideCountMode}
					slideCount={slideCount}
					customSlideCount={customSlideCount}
					onSlideCountModeChange={onSlideCountModeChange}
					onSlideCountChange={onSlideCountChange}
					onCustomSlideCountChange={onCustomSlideCountChange}
				/>
			</div>
		</div>
	);
};
