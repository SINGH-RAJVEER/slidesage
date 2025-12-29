import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { DetailLevelSelector } from "./DetailLevelSelector";
import { TonalitySelector } from "./TonalitySelector";
import { SlideCountSelector } from "./SlideCountSelector";

interface GenerateOptionsBarProps {
  showBackButton: boolean;
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
  showBackButton,
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
  if (!showBackButton) return null;

  return (
    <div className="absolute bottom-[calc(100%+1rem)] left-0 right-0 flex items-center justify-between bg-white/10 backdrop-blur-md rounded-2xl px-6 py-3 border border-white/20">
      <Button
        onClick={onBackClick}
        variant="outline"
        className="bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200"
      >
        <ArrowLeft className="w-4 h-4" />
      </Button>
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
