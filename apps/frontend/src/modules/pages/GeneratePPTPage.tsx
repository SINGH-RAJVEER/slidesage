import { useDebouncedCallback } from "@tanstack/react-pacer/debouncer";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import {
  GenerateForm,
  GenerateOptionsBar,
} from "@/components/presentations/GeneratePPTPage";
import { useStreaming } from "@/modules/presentations";
import { ROUTES } from "@/router/paths";

export default function GeneratePPTPage() {
  const [prompt, setPrompt] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [slideCount, setSlideCount] = useState("5");
  const [slideCountMode, setSlideCountMode] = useState("preset");
  const [customSlideCount, setCustomSlideCount] = useState("5");
  const [detailLevel, setDetailLevel] = useState("balanced");
  const [tonality, setTonality] = useState("professional");
  const [useWebResearch, setUseWebResearch] = useState(false);
  const navigate = useNavigate();
  const { streamingState, startStreaming, resetStreaming } = useStreaming();

  useEffect(() => {
    resetStreaming();
  }, [resetStreaming]);

  // Navigate to viewer when first slide arrives
  useEffect(() => {
    if (streamingState.slides.length >= 1 && loading) {
      setLoading(false);
      navigate(ROUTES.presentation, {
        state: {
          isStreaming: true,
        },
      });
    }
  }, [streamingState.slides.length, loading, navigate]);

  // Handle streaming errors
  useEffect(() => {
    if (streamingState.error) {
      setError(streamingState.error);
      setLoading(false);
    }
  }, [streamingState.error]);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && prompt.trim()) {
      e.preventDefault();
      if (!topics.includes(prompt.trim())) {
        setTopics([...topics, prompt.trim()]);
      }
      setPrompt("");
    }
  };

  const handleRemoveTopic = (topicToRemove: string) => {
    setTopics(topics.filter((topic) => topic !== topicToRemove));
  };

  const handleGenerateInternal = async () => {
    if (topics.length === 0) return;

    setLoading(true);
    setError("");

    // Get the slide count (either from preset or custom)
    const count =
      slideCountMode === "preset"
        ? parseInt(slideCount)
        : parseInt(customSlideCount);

    const success = await startStreaming(
      topics.join(", "),
      count,
      detailLevel,
      tonality,
      useWebResearch,
    );

    if (!success) {
      setLoading(false);
    }
  };

  const handleGenerate = useDebouncedCallback(handleGenerateInternal, {
    wait: 500,
    leading: true,
  });

  // Calculate estimated token usage based on selections
  const calculateEstimatedTokens = () => {
    const count =
      slideCountMode === "preset"
        ? parseInt(slideCount)
        : parseInt(customSlideCount);

    let baseTokenPerSlide = 1;

    if (detailLevel === "brief") {
      baseTokenPerSlide = 0.6;
    } else if (detailLevel === "concise") {
      baseTokenPerSlide = 0.8;
    } else if (detailLevel === "detailed") {
      baseTokenPerSlide = 2.0;
    } else if (detailLevel === "comprehensive") {
      baseTokenPerSlide = 3.0;
    }

    let tonalityMultiplier = 1.0;
    if (tonality === "casual") {
      tonalityMultiplier = 0.9;
    } else if (tonality === "enthusiastic") {
      tonalityMultiplier = 1.05;
    } else if (tonality === "persuasive") {
      tonalityMultiplier = 1.1;
    }

    const estimatedTokens = count * baseTokenPerSlide * tonalityMultiplier;
    return estimatedTokens;
  };

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col">
      <Header />
      <div className="flex-1 p-4 md:p-8 flex items-center justify-center overflow-y-auto">
        <div className="w-full max-w-4xl relative">
          <GenerateOptionsBar
            detailLevel={detailLevel}
            tonality={tonality}
            useWebResearch={useWebResearch}
            slideCountMode={slideCountMode}
            slideCount={slideCount}
            customSlideCount={customSlideCount}
            onBackClick={() => navigate(ROUTES.presentations)}
            onDetailLevelChange={setDetailLevel}
            onTonalityChange={setTonality}
            onUseWebResearchChange={setUseWebResearch}
            onSlideCountModeChange={setSlideCountMode}
            onSlideCountChange={setSlideCount}
            onCustomSlideCountChange={setCustomSlideCount}
          />
          <GenerateForm
            prompt={prompt}
            topics={topics}
            loading={loading}
            error={error}
            estimatedTokens={calculateEstimatedTokens()}
            onPromptChange={setPrompt}
            onKeyDown={handleKeyDown}
            onRemoveTopic={handleRemoveTopic}
            onGenerate={handleGenerate}
          />
          {loading &&
          useWebResearch &&
          (streamingState.researchSummary ||
            (streamingState.researchSources?.length ?? 0) > 0) ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-white shadow-lg backdrop-blur">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Midway Research</h3>
                <span className="text-xs uppercase tracking-wide text-white/60">
                  Live summary
                </span>
              </div>
              {streamingState.researchSummary ? (
                <div className="mt-3 space-y-2 text-sm text-white/80">
                  {streamingState.researchSummary
                    .split("\n")
                    .filter((line) => line.trim().length > 0)
                    .map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-white/60">
                  Summarizing web research...
                </p>
              )}
              {streamingState.researchSources?.length ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase text-white/60">
                    Sources
                  </p>
                  <ul className="mt-2 space-y-2 text-xs text-white/70">
                    {streamingState.researchSources
                      .slice(0, 6)
                      .map((source) => (
                        <li key={source.url} className="break-words">
                          <span className="font-medium text-white">
                            {source.title || source.url}
                          </span>
                          <span className="ml-2 text-white/50">
                            {source.url}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
