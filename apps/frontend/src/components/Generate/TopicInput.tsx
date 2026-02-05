import { X } from "lucide-react";
import type React from "react";
import { Input } from "@/components/ui/input";

interface TopicInputProps {
  prompt: string;
  topics: string[];
  onPromptChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveTopic: (topic: string) => void;
  onEditTopic: (index: number, value: string) => void;
  disabled: boolean;
}

export const TopicInput: React.FC<TopicInputProps> = ({
  prompt,
  topics,
  onPromptChange,
  onKeyDown,
  onRemoveTopic,
  onEditTopic,
  disabled,
}) => {
  return (
    <div className="space-y-15">
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {topics.map((topic, index) => (
            <div
              key={`${index}-${topic}`}
              className="group flex items-center gap-1 pl-3 pr-3 py-2 bg-white/5 border border-white/10 rounded-full text-white/90 backdrop-blur-sm transition-all hover:bg-white/10 hover:border-white/20"
            >
              <button
                type="button"
                onClick={() => onRemoveTopic(topic)}
                className="p-1 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </button>
              <input
                type="text"
                value={topic}
                onChange={(e) => onEditTopic(index, e.target.value)}
                disabled={disabled}
                className="flex-none w-auto p-0 bg-transparent text-white/90 font-light tracking-wide text-base focus:outline-none focus:ring-0"
                style={{ width: `${Math.max(topic.length, 1)}ch` }}
                aria-label={`Topic ${index + 1}`}
              />
            </div>
          ))}
        </div>
      )}
      <div className="relative group max-w-l mx-auto">
        <Input
          id="prompt"
          placeholder={
            topics.length === 0
              ? "What's on your mind ?"
              : "Add additional context ?"
          }
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full text-center bg-black/20 border border-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] rounded-lg text-xl md:text-2xl px-5 py-6 h-auto text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:border-white/30 font-light tracking-wide transition-all"
          disabled={disabled}
          autoFocus
        />
      </div>

      <p className="text-center text-white/30 font-light text-base">
        Press <span className="text-white/50">Enter</span> to add a topic
      </p>
    </div>
  );
};
