import { Loader2, Sparkles } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { TopicInput } from "./TopicInput";

interface GenerateFormProps {
  prompt: string;
  topics: string[];
  loading: boolean;
  error: string;
  estimatedTokens: number;
  onPromptChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveTopic: (topic: string) => void;
  onEditTopic: (index: number, value: string) => void;
  onGenerate: () => void;
}

export const GenerateForm: React.FC<GenerateFormProps> = ({
  prompt,
  topics,
  loading,
  error,
  estimatedTokens,
  onPromptChange,
  onKeyDown,
  onRemoveTopic,
  onEditTopic,
  onGenerate,
}) => {
  return (
    <div className="w-full max-w-2xl mx-auto py-16">
      <div className="space-y-2 mb-16 text-center">
        {topics.length > 0 && (
          <p className="text-xl font-light text-white/60">
            Est. {estimatedTokens.toFixed(1)} points
          </p>
        )}
      </div>

      <div className="space-y-16">
        <TopicInput
          prompt={prompt}
          topics={topics}
          onPromptChange={onPromptChange}
          onKeyDown={onKeyDown}
          onRemoveTopic={onRemoveTopic}
          onEditTopic={onEditTopic}
          disabled={loading}
        />

        <div className="flex justify-center">
          <Button
            onClick={onGenerate}
            disabled={loading || topics.length === 0}
            className="relative group overflow-hidden px-10 py-8 bg-white/10 hover:bg-white/15 backdrop-blur-md rounded-full border border-white/20 text-white transition-all duration-300 hover:border-white/40 hover:shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]"
          >
            <span className="relative flex items-center gap-4 text-xl font-light tracking-wide">
              {loading ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-6 w-6 opacity-70 group-hover:opacity-100 transition-opacity" />
                  Start Generating
                </>
              )}
            </span>
          </Button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-200 px-6 py-4 rounded-xl backdrop-blur-sm text-center font-light">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
