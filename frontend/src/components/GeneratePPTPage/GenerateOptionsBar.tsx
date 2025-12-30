import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { DetailLevelSelector } from "./DetailLevelSelector";
import { TonalitySelector } from "./TonalitySelector";
import { SlideCountSelector } from "./SlideCountSelector";

interface GenerateOptionsBarProps {
  detailLevel: string;
  tonality: string;
  slideCountMode: string;
  slideCount: string;
  customSlideCount: string;
  onBackClick: () => void;
  onDetailLevelChange: (level: string) => void;
  onTonalityChange: (tonality: string) => void;
  onSlideCountModeChange: (mode: string) => void;
  onSlideCountChange: (count: string) => void;
  onCustomSlideCountChange: (count: string) => void;
}

export const GenerateOptionsBar: React.FC<GenerateOptionsBarProps> = ({
  detailLevel,
  tonality,
  slideCountMode,
  slideCount,
  customSlideCount,
  onBackClick,
  onDetailLevelChange,
  onTonalityChange,
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
            Back to Generated
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
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
