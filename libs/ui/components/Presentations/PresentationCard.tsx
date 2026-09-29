import type { PresentationSummary } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@slidesage/ui/components/card";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { Ban, Calendar, RotateCcw, Trash2 } from "lucide-react";
import type React from "react";

interface PresentationCardProps {
	presentation: PresentationSummary;
	isDeleting: boolean;
	isOpening: boolean;
	onCardClick: (id: string) => void;
	onDelete: (e: React.MouseEvent, id: string) => void;
	formatDate: (date: string) => string;
}

export const PresentationCard: React.FC<PresentationCardProps> = ({
	presentation,
	isDeleting,
	isOpening,
	onCardClick,
	onDelete,
	formatDate,
}) => {
	// A deck from before card documents cannot be opened, only deleted.
	const unavailable = presentation.status === "unavailable";
	return (
		<Card
			className={`group flex h-full flex-col border bg-black/20 transition-colors ${
				unavailable ? "cursor-default opacity-60" : "cursor-pointer hover:bg-white/5"
			} ${presentation.status === "failed" ? "border-red-300/20" : "border-white/10"}`}
			onClick={() => !isOpening && !unavailable && onCardClick(presentation.id)}
		>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-start justify-between gap-2 text-lg text-white">
					<span className="min-w-0 flex-1">
						{presentation.status === "failed" && (
							<span className="mb-2 flex items-center gap-1.5 text-xs font-medium text-red-300">
								{isOpening ? <ThinkingOrb size={20} /> : <RotateCcw className="h-3.5 w-3.5" />}
								Ready to retry
							</span>
						)}
						{unavailable && (
							<span className="mb-2 flex items-center gap-1.5 text-xs font-medium text-white/50">
								<Ban className="h-3.5 w-3.5" />
								Made with an earlier version and can no longer be opened
							</span>
						)}
						<span className="line-clamp-2 block font-light opacity-90">{presentation.title}</span>
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-white/40 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0 ml-2 -mt-0.5"
						aria-label="Delete presentation"
						onClick={(e) => onDelete(e, presentation.id)}
						disabled={isDeleting}
					>
						{isDeleting ? <ThinkingOrb size={20} /> : <Trash2 className="h-4 w-4" />}
					</Button>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col space-y-3">
				<p className="text-white/40 text-sm line-clamp-3 mt-auto font-light">
					{presentation.prompt}
				</p>
				<div className="flex items-center gap-2 border-t border-white/10 pt-3 text-xs uppercase text-white/30">
					<Calendar className="h-3 w-3" />
					<span>{formatDate(presentation.created_at)}</span>
				</div>
			</CardContent>
		</Card>
	);
};
