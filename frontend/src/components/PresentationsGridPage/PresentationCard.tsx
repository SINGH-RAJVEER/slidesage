import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Trash2, Loader2 } from "lucide-react";

interface Presentation {
  id: number;
  title: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

interface PresentationCardProps {
  presentation: Presentation;
  isDeleting: boolean;
  onCardClick: (id: number) => void;
  onDelete: (e: React.MouseEvent, id: number) => void;
  formatDate: (date: string) => string;
}

export const PresentationCard: React.FC<PresentationCardProps> = ({
  presentation,
  isDeleting,
  onCardClick,
  onDelete,
  formatDate,
}) => {
  return (
    <Card
      className="group cursor-pointer shadow-lg border border-white/20 bg-white/10 backdrop-blur-md hover:bg-white/15 transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] flex flex-col h-full"
      onClick={() => onCardClick(presentation.id)}
    >
      <CardHeader className="pb-4">
        <CardTitle className="text-white text-xl line-clamp-2 flex items-start justify-between">
          <span className="flex-1">{presentation.title}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/60 hover:text-red-400 hover:bg-red-500/20 flex-shrink-0 ml-2"
            onClick={(e) => onDelete(e, presentation.id)}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 flex flex-col">
        <p className="text-white/70 text-sm line-clamp-3 mt-auto">
          {presentation.prompt}
        </p>
        <div className="flex items-center gap-2 text-white/50 text-xs pt-2 border-t border-white/10">
          <Calendar className="h-3 w-3" />
          <span>{formatDate(presentation.created_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
};
