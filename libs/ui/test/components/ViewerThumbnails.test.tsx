/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { ViewerThumbnails } from "@slidesage/ui/components/Viewer/ViewerThumbnails";
import type { ViewerDocument } from "@slidesage/ui/lib/viewer-document";
import { render, waitFor } from "@testing-library/react";

it("keeps the active thumbnail in view when the current slide changes", async () => {
	const originalScrollTo = HTMLElement.prototype.scrollTo;
	const scrollTo = mock();
	Object.defineProperty(HTMLElement.prototype, "scrollTo", {
		configurable: true,
		value: scrollTo,
	});
	const document: ViewerDocument = {
		kind: "images",
		slideCount: 3,
		slides: ["/previews/0.webp", "/previews/1.webp", "/previews/2.webp"],
	};
	const props = {
		document,
		isStreamingMode: false,
		isStreaming: false,
		onSelect: mock(),
	};
	try {
		const view = render(<ViewerThumbnails {...props} currentSlide={0} />);
		const container = view.container.querySelector<HTMLElement>(".slide-thumbnails-container");
		const lastThumbnail = view.getByRole("button", { name: "Go to slide 3" });
		Object.defineProperties(container, {
			scrollLeft: { configurable: true, value: 20 },
			getBoundingClientRect: {
				configurable: true,
				value: () => ({ left: 100, width: 500 }),
			},
		});
		Object.defineProperty(lastThumbnail, "getBoundingClientRect", {
			configurable: true,
			value: () => ({ left: 550, width: 128 }),
		});
		scrollTo.mockClear();

		view.rerender(<ViewerThumbnails {...props} currentSlide={2} />);

		await waitFor(() => {
			expect(scrollTo).toHaveBeenCalledWith({
				behavior: "smooth",
				left: 284,
			});
		});
	} finally {
		Object.defineProperty(HTMLElement.prototype, "scrollTo", {
			configurable: true,
			value: originalScrollTo,
		});
	}
});
