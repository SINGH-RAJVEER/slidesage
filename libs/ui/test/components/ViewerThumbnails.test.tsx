/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { assembleDocument, type Card, convertCards } from "@slidesage/cards";
import { deckFromDocument } from "@slidesage/ui/components/Viewer/deck";
import { ViewerThumbnails } from "@slidesage/ui/components/Viewer/ViewerThumbnails";
import { render, waitFor } from "@testing-library/react";

function deck() {
	const results = convertCards({
		operationId: "thumbnails",
		sourceIds: [],
		cards: ["First point", "Second point", "Third point"].map((heading, index) => ({
			position: index + 1,
			takeaway: heading,
			role: index === 0 ? "opening" : "insight",
			draft: { layout: "title", nodes: [{ type: "heading", text: heading }] },
		})),
	});
	const cards = results.map((result) => {
		if (!("card" in result)) throw new Error(result.issue.message);
		return result.card as Card;
	});
	return deckFromDocument(assembleDocument({ title: "Grid storage", theme: "slate", cards }));
}

it("keeps the active thumbnail in view when the current slide changes", async () => {
	const originalScrollTo = HTMLElement.prototype.scrollTo;
	const scrollTo = mock();
	Object.defineProperty(HTMLElement.prototype, "scrollTo", {
		configurable: true,
		value: scrollTo,
	});
	const props = {
		deck: deck(),
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

it("draws each card read-only inside its thumbnail", () => {
	const view = render(
		<ViewerThumbnails deck={deck()} currentSlide={0} isStreaming={false} onSelect={mock()} />,
	);

	const thumbnail = view.getByRole("button", { name: "Go to slide 2" });
	expect(thumbnail.querySelector("article")).toHaveAccessibleName("Card 2: Second point");
	expect(thumbnail.querySelector("[contenteditable]")).toBeNull();
});
