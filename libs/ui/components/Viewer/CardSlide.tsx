import { useLayoutEffect, useRef, useState } from "react";
import { CardView, type CardViewProps } from "../Cards/CardView";

/**
 * A card fitted inside a fixed slide box. Card text is sized in container
 * units, so a card keeps its proportions at any width; a card that grows
 * taller than 16:9 is drawn narrower until its whole height fits, the way
 * PPTX export shrinks it, rather than being cropped by the box.
 */
export function CardSlide({ className = "", ...card }: CardViewProps & { className?: string }) {
	const boxRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number>();

	useLayoutEffect(() => {
		const box = boxRef.current;
		if (!box || typeof ResizeObserver === "undefined") return undefined;
		const fit = () => {
			const article = box.querySelector("article");
			if (!article || article.offsetWidth === 0 || box.clientHeight === 0) return;
			const ratio = article.offsetHeight / article.offsetWidth;
			const fitted = Math.min(box.clientWidth, box.clientHeight / ratio);
			setWidth((current) =>
				current !== undefined && Math.abs(current - fitted) < 0.5 ? current : fitted,
			);
		};
		const observer = new ResizeObserver(fit);
		observer.observe(box);
		const article = box.querySelector("article");
		if (article) observer.observe(article);
		fit();
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={boxRef}
			className={`flex h-full w-full items-center justify-center overflow-hidden ${className}`}
		>
			<div className="shrink-0" style={{ width: width ?? "100%" }}>
				<CardView {...card} />
			</div>
		</div>
	);
}
