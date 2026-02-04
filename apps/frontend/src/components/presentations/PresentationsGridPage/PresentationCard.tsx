import { Calendar, Loader2, Trash2 } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      className="group cursor-pointer shadow-lg border border-white/5 bg-black/20 backdrop-blur-md hover:bg-black/40 transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] flex flex-col h-full"
      onClick={() => onCardClick(presentation.id)}
    >
      <CardHeader className="pb-4">
        <CardTitle className="text-white text-xl line-clamp-2 flex items-start justify-between">
          <span className="flex-1 font-light opacity-90">
            {presentation.title}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/40 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0 ml-2"
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
        <p className="text-white/40 text-sm line-clamp-3 mt-auto font-light">
          {presentation.prompt}
        </p>
        <div className="flex items-center gap-2 text-white/20 text-xs pt-4 border-t border-white/10 uppercase tracking-wider">
          <Calendar className="h-3 w-3" />
          <span>{formatDate(presentation.created_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
};
