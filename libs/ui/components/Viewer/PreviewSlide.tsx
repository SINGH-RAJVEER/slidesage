import { useEffect, useRef, useState } from "react";
import type { PreviewDocument } from "../../hooks/useRevisionPreviews";

export function PreviewSlide({
	document,
	index,
	className = "",
}: {
	document: PreviewDocument;
	index: number;
	className?: string;
}) {
	const fallback = document.slides[index];
	if (document.viewer) {
		return (
			<BrowserRenderedSlide
				document={document}
				index={index}
				fallback={fallback}
				className={className}
			/>
		);
	}
	if (!fallback) return null;
	return (
		<img
			src={fallback}
			alt={`Slide ${index + 1}`}
			className={`h-full object-contain ${className}`}
			loading="lazy"
			crossOrigin="use-credentials"
		/>
	);
}

function BrowserRenderedSlide({
	document,
	index,
	fallback,
	className,
}: {
	document: PreviewDocument;
	index: number;
	fallback?: string;
	className: string;
}) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const host = hostRef.current;
		const viewer = document.viewer;
		if (!host || !viewer) return;

		let disposed = false;
		let slideHandle: ReturnType<typeof viewer.renderThumbnailToContainer> = null;
		let resizeObserver: ResizeObserver | undefined;
		let intersectionObserver: IntersectionObserver | undefined;
		let animationFrame = 0;
		let lastWidth = -1;
		let lastHeight = -1;

		const render = () => {
			if (disposed) return;
			const width = host.clientWidth || viewer.slideWidth;
			const height = host.clientHeight || viewer.slideHeight;
			if (width === lastWidth && height === lastHeight) return;
			lastWidth = width;
			lastHeight = height;
			slideHandle?.dispose();
			host.replaceChildren();
			slideHandle = viewer.renderThumbnailToContainer(index, host, { width, height });
			if (!slideHandle) return;
			void slideHandle.ready
				.then(() => {
					if (!disposed) setReady(true);
				})
				.catch(() => {
					if (!disposed) setReady(false);
				});
		};

		const scheduleRender = () => {
			cancelAnimationFrame(animationFrame);
			animationFrame = requestAnimationFrame(render);
		};

		const beginRendering = () => {
			intersectionObserver?.disconnect();
			render();
			if ("ResizeObserver" in window) {
				resizeObserver = new ResizeObserver(scheduleRender);
				resizeObserver.observe(host);
			}
		};

		if ("IntersectionObserver" in window) {
			intersectionObserver = new IntersectionObserver(
				(entries) => {
					if (entries.some((entry) => entry.isIntersecting)) beginRendering();
				},
				{ rootMargin: "300px" },
			);
			intersectionObserver.observe(host);
		} else {
			beginRendering();
		}

		return () => {
			disposed = true;
			cancelAnimationFrame(animationFrame);
			intersectionObserver?.disconnect();
			resizeObserver?.disconnect();
			slideHandle?.dispose();
			host.replaceChildren();
		};
	}, [document.viewer, index]);

	return (
		<div
			className={`relative flex h-full items-center justify-center overflow-hidden bg-white ${className}`}
			role="img"
			aria-label={`Slide ${index + 1}`}
		>
			{fallback && (
				<img
					src={fallback}
					alt=""
					aria-hidden="true"
					className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${ready ? "opacity-0" : "opacity-100"}`}
					loading="lazy"
					crossOrigin="use-credentials"
				/>
			)}
			<div
				ref={hostRef}
				data-pptx-slide={index}
				className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
			/>
		</div>
	);
}
