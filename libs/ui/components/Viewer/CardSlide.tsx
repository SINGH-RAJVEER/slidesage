import { CardView, type CardViewProps } from "../Cards/CardView";

/**
 * A card fitted inside a slide box. A card is always 16:9, so it takes the
 * box's full width, or less when the box is proportionally taller, and is
 * centred in whatever space is left.
 */
export function CardSlide({ className = "", ...card }: CardViewProps & { className?: string }) {
	return (
		<div
			className={`@container-[size] flex h-full w-full items-center justify-center overflow-hidden ${className}`}
		>
			<div className="w-[min(100cqw,calc(100cqh*16/9))] shrink-0">
				<CardView {...card} />
			</div>
		</div>
	);
}
