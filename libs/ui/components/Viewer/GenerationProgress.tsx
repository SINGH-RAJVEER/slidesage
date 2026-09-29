import type { PresentationGenerationStage } from "@slidesage/types";
import { Progress } from "@slidesage/ui/components/progress";
import { cn } from "@slidesage/ui/lib/utils";

/**
 * How far along the bar sits for each stage the worker reports. The worker
 * cannot say how much of a stage is done, so each stage has one position and
 * the bar only ever moves when the stage changes.
 */
const STAGE_PROGRESS: Record<PresentationGenerationStage, { label: string; percent: number }> = {
	planning: { label: "Planning outline", percent: 20 },
	drafting: { label: "Writing slides", percent: 55 },
	finalizing: { label: "Finalizing deck", percent: 90 },
};

const QUEUED = { label: "Queued", percent: 6 };
const RESEARCHING = { label: "Researching sources", percent: 12 };

interface GenerationProgressProps {
	/** Latest stage from the SSE stream; absent until the first stage event. */
	stage?: PresentationGenerationStage;
	/** Research runs before the worker reports a stage of its own. */
	isResearching?: boolean;
	/** Stage text the worker sent, used when it reports a stage we do not know. */
	message?: string;
	className?: string;
}

/**
 * Minimal progress readout for a deck that is still generating: a thin bar and
 * the name of the stage it is on.
 */
export function GenerationProgress({
	stage,
	isResearching = false,
	message,
	className,
}: GenerationProgressProps) {
	const known = stage ? STAGE_PROGRESS[stage] : undefined;
	const current = isResearching
		? RESEARCHING
		: (known ?? (stage ? { label: message || stage, percent: QUEUED.percent } : QUEUED));

	return (
		<div className={cn("flex w-full max-w-64 flex-col items-center gap-2", className)}>
			<Progress value={current.percent} aria-label="Generation progress" />
			<span aria-live="polite" className="text-xs font-medium tracking-wide text-white/60">
				{current.label}
			</span>
		</div>
	);
}
