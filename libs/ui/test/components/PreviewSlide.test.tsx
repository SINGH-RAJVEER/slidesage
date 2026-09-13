/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import type { PptxViewer, SlideHandle } from "@aiden0z/pptx-renderer";
import { PreviewSlide } from "@slidesage/ui/components/Viewer/PreviewSlide";
import type { ViewerDocument } from "@slidesage/ui/lib/viewer-document";
import { render, waitFor } from "@testing-library/react";

it("uses an immutable image when browser rendering is unavailable", () => {
	const document: ViewerDocument = {
		kind: "images",
		slideCount: 1,
		slides: ["/previews/0.webp"],
	};

	const view = render(<PreviewSlide document={document} index={0} />);

	expect(view.getByRole("img", { name: "Slide 1" })).toHaveAttribute("src", "/previews/0.webp");
});

it("renders the canonical PPTX into the existing slide box", async () => {
	const originalIntersectionObserver = window.IntersectionObserver;
	window.IntersectionObserver = class ImmediateIntersectionObserver {
		private readonly callback: IntersectionObserverCallback;
		constructor(callback: IntersectionObserverCallback) {
			this.callback = callback;
		}
		observe(target: Element) {
			this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
		}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
		root = null;
		rootMargin = "0px";
		scrollMargin = "0px";
		thresholds = [0];
	} as unknown as typeof IntersectionObserver;
	const dispose = mock();
	const renderThumbnailToContainer = mock((index: number, container: HTMLElement) => {
		const element = document.createElement("div");
		element.dataset["renderedSlide"] = String(index);
		container.appendChild(element);
		return {
			element,
			ready: Promise.resolve(),
			dispose,
			[Symbol.dispose]: dispose,
		} satisfies SlideHandle;
	});
	const viewer = {
		slideWidth: 960,
		slideHeight: 540,
		renderThumbnailToContainer,
	} as unknown as PptxViewer;
	const pptx: ViewerDocument = {
		kind: "pptx",
		viewer,
		slideCount: 1,
	};

	try {
		const view = render(<PreviewSlide document={pptx} index={0} />);

		await waitFor(() => expect(renderThumbnailToContainer).toHaveBeenCalledTimes(1));
		expect(view.container.querySelector('[data-rendered-slide="0"]')).toBeInTheDocument();
		expect(view.container.querySelector("img")).toBeNull();

		view.unmount();
		expect(dispose).toHaveBeenCalledTimes(1);
	} finally {
		window.IntersectionObserver = originalIntersectionObserver;
	}
});
