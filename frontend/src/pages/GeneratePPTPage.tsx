import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { authService } from "@/services/authService";
import Header from "@/components/Header";
import { useStreaming } from "@/contexts/StreamingContext";
import { GenerateOptionsBar, GenerateForm } from "@/components/GeneratePPTPage";

const API_URL = import.meta.env.VITE_API_URL;

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
  const navigate = useNavigate();
  const location = useLocation();
  const { streamingState, startStreaming, resetStreaming } = useStreaming();

  useEffect(() => {
    // Reset streaming state when entering generate page
    resetStreaming();
  }, []);

  // Navigate to viewer when first slide arrives
  useEffect(() => {
    if (streamingState.slides.length >= 1 && loading) {
      setLoading(false);
      navigate("/presentation", {
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

  const handleGenerate = async () => {
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
      tonality
    );

    if (!success) {
      setLoading(false);
    }
  };

  // Calculate estimated token usage based on selections
  const calculateEstimatedTokens = () => {
    const count =
      slideCountMode === "preset"
        ? parseInt(slideCount)
        : parseInt(customSlideCount);

    // 1 slide token = 1000 AI tokens
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

    // Calculate total
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
            slideCountMode={slideCountMode}
            slideCount={slideCount}
            customSlideCount={customSlideCount}
            onBackClick={() => navigate("/presentations")}
            onDetailLevelChange={setDetailLevel}
            onTonalityChange={setTonality}
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
        </div>
      </div>
    </div>
  );
}
