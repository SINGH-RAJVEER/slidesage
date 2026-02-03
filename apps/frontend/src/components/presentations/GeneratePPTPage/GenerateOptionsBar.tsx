import { ArrowLeft, Globe } from "lucide-react";
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
  onBackClick: () => void;
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
  onBackClick,
  onDetailLevelChange,
  onTonalityChange,
  onUseWebResearchChange,
  onSlideCountModeChange,
  onSlideCountChange,
  onCustomSlideCountChange,
}) => {
  return (
    <div className="absolute bottom-[calc(100%+1rem)] left-0 right-0 flex items-center justify-between bg-white/10 backdrop-blur-md rounded-2xl px-6 py-3 border border-white/20">
      <div className="relative group">
        <Button
          onClick={onBackClick}
          variant="outline"
          className="bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
          <div className="bg-white/10 backdrop-blur-lg border border-white/30 text-white px-4 py-2 rounded-lg shadow-lg whitespace-nowrap">
            Back to Presentations
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-white/70 text-sm">Web:</span>
          <Button
            type="button"
            variant="outline"
            aria-pressed={useWebResearch}
            onClick={() => onUseWebResearchChange(!useWebResearch)}
            className={`w-24 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between ${
              useWebResearch ? "bg-white/20 border-white/30" : ""
            }`}
          >
            <span className="flex items-center">
              <Globe className="h-4 w-4 mr-2 opacity-70" />
              {useWebResearch ? "On" : "Off"}
            </span>
          </Button>
        </div>
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
