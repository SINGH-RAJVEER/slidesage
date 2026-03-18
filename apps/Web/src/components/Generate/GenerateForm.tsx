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
    <div className="mx-auto w-full max-w-2xl py-10">
      <div className="mb-8 text-center">
        {topics.length > 0 && (
          <p className="text-sm font-medium text-white/70">
            Est. {estimatedTokens.toFixed(1)} points
          </p>
        )}
      </div>

      <div className="space-y-10">
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
            className="group h-11 rounded-md border border-white/20 bg-white/10 px-6 text-white transition-colors hover:bg-white/15"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 opacity-80" />
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
