import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TopicInput } from "./TopicInput";

interface GenerateFormProps {
  prompt: string;
  topics: string[];
  loading: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveTopic: (topic: string) => void;
  onGenerate: () => void;
}

export const GenerateForm: React.FC<GenerateFormProps> = ({
  prompt,
  topics,
  loading,
  error,
  onPromptChange,
  onKeyDown,
  onRemoveTopic,
  onGenerate,
}) => {
  return (
    <Card className="shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md">
      <CardHeader className="space-y-3 pb-8">
        <CardTitle className="flex items-center gap-2 text-white text-4xl">
          Generate Presentation
        </CardTitle>
        <div className="h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
      </CardHeader>
      <CardContent className="px-8 pb-8 space-y-6">
        <TopicInput
          prompt={prompt}
          topics={topics}
          onPromptChange={onPromptChange}
          onKeyDown={onKeyDown}
          onRemoveTopic={onRemoveTopic}
          disabled={loading}
        />

        <div className="flex justify-center my-8">
          <Button
            onClick={onGenerate}
            disabled={loading || topics.length === 0}
            className="w-1/3 bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-14 text-lg font-semibold"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Generating
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                Generate Presentation
              </>
            )}
          </Button>
        </div>
        {error && (
          <Alert
            variant="destructive"
            className="bg-red-500/20 border-red-500/50 text-white"
          >
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};
