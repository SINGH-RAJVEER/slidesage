import { useEffect, useRef, useState } from "react";
import type { ViewerDocument } from "../../lib/viewer-document";

export function PreviewSlide({
	document,
	index,
	className = "",
}: {
	document: ViewerDocument;
	index: number;
	className?: string;
}) {
	if (document.kind === "pptx") {
		return <BrowserRenderedSlide viewer={document.viewer} index={index} className={className} />;
	}
	const source = document.slides[index];
	if (!source) return null;
	return (
		<img
			src={source}
			alt={`Slide ${index + 1}`}
			className={`h-full object-contain ${className}`}
			loading="lazy"
			crossOrigin="use-credentials"
		/>
	);
}

function BrowserRenderedSlide({
	viewer,
	index,
	className,
}: {
	viewer: Extract<ViewerDocument, { kind: "pptx" }>["viewer"];
	index: number;
	className: string;
}) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

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
			try {
				slideHandle = viewer.renderThumbnailToContainer(index, host, { width, height });
				if (!slideHandle) {
					setFailed(true);
					return;
				}
				setFailed(false);
				void slideHandle.ready.catch(() => {
					if (!disposed) setFailed(true);
				});
			} catch {
				setFailed(true);
			}
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
	}, [index, viewer]);

	return (
		<div
			className={`relative flex h-full items-center justify-center overflow-hidden bg-white ${className}`}
			role="img"
			aria-label={`Slide ${index + 1}`}
		>
			<div
				ref={hostRef}
				data-pptx-slide={index}
				className="absolute inset-0 flex items-center justify-center"
			/>
			{failed && <span className="text-sm text-slate-700">Could not render this slide.</span>}
		</div>
	);
}
