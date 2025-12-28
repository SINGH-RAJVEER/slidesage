import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Sparkles } from "lucide-react";

interface IterateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIterate: (prompt: string) => void;
  isStreaming: boolean;
}

export default function IterateModal({
  open,
  onOpenChange,
  onIterate,
  isStreaming,
}: IterateModalProps) {
  const [iteratePrompt, setIteratePrompt] = useState("");

  const handleSubmit = () => {
    if (iteratePrompt.trim()) {
      onIterate(iteratePrompt);
      setIteratePrompt("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md text-white">
        <DialogHeader className="space-y-3 pb-4">
          <DialogTitle className="flex items-center gap-2 text-white text-3xl">
            <Sparkles className="h-6 w-6" />
            Iterate on Presentation
          </DialogTitle>
          <div className="h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
        </DialogHeader>
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="block text-lg font-medium text-white/80">
              Describe Your Changes
            </label>
            <Textarea
              placeholder="e.g., 'Add more details to slide 3', 'Make it more casual', 'Add charts'"
              value={iteratePrompt}
              onChange={(e) => setIteratePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && iteratePrompt.trim()) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="text-xl bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 min-h-[200px] resize-none"
              disabled={isStreaming}
            />
          </div>

          <div className="flex justify-center pt-4">
            <Button
              onClick={handleSubmit}
              disabled={!iteratePrompt.trim() || isStreaming}
              className="w-1/2 bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-14 text-lg font-semibold"
            >
              {isStreaming ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Generating
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" />
                  Generate Iteration
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
