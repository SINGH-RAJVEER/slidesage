import { Button } from "@slidesage/ui/components/button";
import { cn } from "@slidesage/ui/lib/utils";
import { Globe } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";

/** The API caps a research search at eight results. */
export const MAX_RESEARCH_RESULTS = 8;
export const DEFAULT_RESEARCH_RESULTS = 5;

const MIN_FRACTION = 1 / MAX_RESEARCH_RESULTS;

// How far a press travels before it is a drag rather than a click.
const DRAG_THRESHOLD_PX = 4;

const clampCount = (count: number) => Math.min(MAX_RESEARCH_RESULTS, Math.max(1, count));
const clampFraction = (fraction: number) => Math.min(1, Math.max(MIN_FRACTION, fraction));

interface WebResearchToggleProps {
	enabled: boolean;
	resultCount: number;
	onEnabledChange: (enabled: boolean) => void;
	onResultCountChange: (count: number) => void;
}

/**
 * The Web Research button doubles as the result count control once research is
 * on. Hovering it fills the button in white up to the count. Like the scrubber
 * in Apple's player, pressing anywhere on the button and dragging moves the
 * fill by the distance dragged, without jumping to the press, and it snaps to
 * the nearest count on release. A press that does not drag still turns
 * research off.
 */
export const WebResearchToggle: React.FC<WebResearchToggleProps> = ({
	enabled,
	resultCount,
	onEnabledChange,
	onResultCountChange,
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	// Refs answer pointer events before the dragging state has rendered.
	const pressRef = useRef<{ pointerId: number; lastX: number } | null>(null);
	const dragRef = useRef<number | null>(null);
	const draggedRef = useRef(false);
	const [dragFraction, setDragFraction] = useState<number | null>(null);
	const dragging = dragFraction !== null;
	const fill = `${(dragFraction ?? resultCount / MAX_RESEARCH_RESULTS) * 100}%`;
	// The count the fill would snap to if released now, which is the committed
	// count once released, so the number fades out on the value it settled on.
	const draggedCount =
		dragFraction === null ? resultCount : clampCount(Math.round(dragFraction * MAX_RESEARCH_RESULTS));

	const changeCount = (count: number) => {
		const next = clampCount(count);
		if (next !== resultCount) onResultCountChange(next);
	};

	const setDrag = (fraction: number | null) => {
		dragRef.current = fraction;
		setDragFraction(fraction);
	};

	const endPress = () => {
		pressRef.current = null;
		if (dragRef.current !== null) setDrag(null);
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!enabled || event.button !== 0) return;
		pressRef.current = { pointerId: event.pointerId, lastX: event.clientX };
		draggedRef.current = false;
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const press = pressRef.current;
		if (!press || press.pointerId !== event.pointerId) return;
		if (dragRef.current === null) {
			if (Math.abs(event.clientX - press.lastX) < DRAG_THRESHOLD_PX) return;
			// Captured only once it is a drag, so a plain press still clicks the button.
			event.currentTarget.setPointerCapture?.(event.pointerId);
			draggedRef.current = true;
			dragRef.current = resultCount / MAX_RESEARCH_RESULTS;
		}
		event.preventDefault();
		// Measured on every move because the control is magnified while dragging,
		// and applied as a step from the last move so reversing past either end
		// responds at once.
		const width = containerRef.current?.getBoundingClientRect().width ?? 0;
		const step = width > 0 ? (event.clientX - press.lastX) / width : 0;
		press.lastX = event.clientX;
		setDrag(clampFraction(dragRef.current + step));
	};

	const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		if (pressRef.current?.pointerId !== event.pointerId) return;
		if (dragRef.current !== null) changeCount(Math.round(dragRef.current * MAX_RESEARCH_RESULTS));
		endPress();
	};

	const handleClick = () => {
		// The click that ends a drag is not a toggle.
		if (draggedRef.current) {
			draggedRef.current = false;
			return;
		}
		onEnabledChange(!enabled);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
		const next = {
			ArrowLeft: resultCount - 1,
			ArrowDown: resultCount - 1,
			ArrowRight: resultCount + 1,
			ArrowUp: resultCount + 1,
			Home: 1,
			End: MAX_RESEARCH_RESULTS,
		}[event.key];
		if (next === undefined) return;
		event.preventDefault();
		changeCount(next);
	};

	return (
		<div
			ref={containerRef}
			data-dragging={dragging}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={endPress}
			onLostPointerCapture={endPress}
			className={cn(
				"group relative inline-flex shrink-0 origin-center rounded-md transition-transform duration-200 ease-out has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/50 data-[dragging=true]:ring-0 motion-safe:data-[dragging=true]:scale-[1.08]",
				// Horizontal touch drags belong to the slider; vertical ones still scroll.
				enabled && "touch-pan-y",
			)}
		>
			<Button
				type="button"
				variant="ghost"
				aria-pressed={enabled}
				onClick={handleClick}
				className={cn(
					"relative isolate h-10 overflow-hidden rounded-md border px-4 transition-colors outline-none select-none focus-visible:ring-0 focus-visible:outline-none",
					enabled
						? "border-white/20 bg-white/10 text-white hover:bg-white/10 hover:text-white"
						: "border-transparent bg-transparent text-white/60 hover:bg-white/5 hover:text-white",
				)}
			>
				{enabled && (
					// Shown on hover, on keyboard focus, and throughout a drag, which
					// can carry the pointer off the button. Mouse focus is left out,
					// since a click focuses the button and would keep the fill up
					// after the pointer leaves. Devices without hover always show it.
					<span
						aria-hidden
						style={{ width: fill }}
						className={cn(
							"pointer-events-none absolute inset-y-0 left-0 bg-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-data-[dragging=true]:opacity-100 [@media(hover:none)]:opacity-100",
							!dragging && "transition-[width,opacity] duration-150 ease-out",
						)}
					/>
				)}
				<span
					className={cn(
						"relative flex items-center gap-2 text-sm leading-4 font-medium transition-opacity duration-150",
						enabled && "mix-blend-difference",
						dragging && "opacity-0",
					)}
				>
					<Globe className="size-4 shrink-0" />
					<span className="translate-y-px">Web Research</span>
				</span>
				{enabled && (
					// While dragging, the label gives way to the count the fill snaps to.
					<span
						aria-hidden
						className={cn(
							"pointer-events-none absolute inset-0 flex items-center justify-center text-sm leading-4 font-medium tabular-nums mix-blend-difference transition-opacity duration-150",
							dragging ? "opacity-100" : "opacity-0",
						)}
					>
						<span className="translate-y-px">{draggedCount}</span>
					</span>
				)}
			</Button>
			{enabled && (
				// Keyboard and assistive technology reach the count here; pointers
				// drag the whole button instead.
				<span
					role="slider"
					tabIndex={0}
					aria-label="Research results"
					aria-orientation="horizontal"
					aria-valuemin={1}
					aria-valuemax={MAX_RESEARCH_RESULTS}
					aria-valuenow={resultCount}
					aria-valuetext={`${resultCount} ${resultCount === 1 ? "result" : "results"}`}
					onKeyDown={handleKeyDown}
					style={{ left: fill }}
					className="pointer-events-none absolute inset-y-0 w-4 -translate-x-1/2 outline-none"
				/>
			)}
		</div>
	);
};
