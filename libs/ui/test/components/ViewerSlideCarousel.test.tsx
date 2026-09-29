/// <reference lib="dom" />

import { describe, expect, it, mock } from "bun:test";
import { assembleDocument, type Card, convertCards } from "@slidesage/cards";
import type { DraftPreview } from "@slidesage/types";
import { deckFromDocument, deckFromPreview } from "@slidesage/ui/components/Viewer/deck";
import { ViewerSlideCarousel } from "@slidesage/ui/components/Viewer/ViewerSlideCarousel";
import { fireEvent, render, within } from "@testing-library/react";
import { createRef } from "react";

function cards(): Card[] {
	const results = convertCards({
		operationId: "carousel",
		sourceIds: ["s1"],
		cards: [
			{
				position: 1,
				takeaway: "Storage is now cheap",
				role: "opening",
				draft: { layout: "title", nodes: [{ type: "heading", text: "Grid **storage**" }] },
			},
			{
				position: 2,
				takeaway: "Prices fell",
				role: "evidence",
				draft: {
					layout: "stats",
					sourceIds: ["s1"],
					nodes: [
						{ type: "heading", text: "Costs fell fast" },
						{ type: "stat", value: "-89%", label: "Pack price since 2010" },
						{ type: "stat", value: "$139", label: "Per kWh in 2023" },
					],
				},
			},
		],
	});
	return results.map((result) => {
		if (!("card" in result)) throw new Error(result.issue.message);
		return result.card;
	});
}

const carouselProps = {
	visibleSlide: 0,
	containerRef: createRef<HTMLDivElement>(),
	onSelectSlide: mock(),
};

describe("ViewerSlideCarousel", () => {
	it("shows every card as a slide, in order, with its citations", () => {
		const document = assembleDocument({ title: "Grid storage", theme: "paper", cards: cards() });
		const view = render(
			<ViewerSlideCarousel
				{...carouselProps}
				deck={deckFromDocument(document, {
					sources: [{ url: "https://example.com/report", title: "Battery report" }],
				})}
			/>,
		);

		const slides = view.getAllByRole("option");
		expect(slides.map((slide) => slide.id)).toEqual(["slide-0", "slide-1"]);
		expect(within(slides[0] as HTMLElement).getByRole("article")).toHaveAccessibleName(
			"Card 1: Storage is now cheap",
		);
		expect(within(slides[1] as HTMLElement).getByRole("link", { name: "[1]" })).toHaveAttribute(
			"href",
			"https://example.com/report",
		);
	});

	it("lets only the slide being edited take edits", () => {
		const document = assembleDocument({ title: "Grid storage", theme: "slate", cards: cards() });
		const view = render(
			<ViewerSlideCarousel
				{...carouselProps}
				deck={deckFromDocument(document)}
				edit={mock()}
				editableSlide={1}
			/>,
		);

		const [first, second] = view.getAllByRole("option") as HTMLElement[];
		expect(first?.querySelector("[contenteditable='true']")).toBeNull();
		expect(second?.querySelector("[contenteditable='true']")).not.toBeNull();
	});

	it("selects a slide when it is clicked", () => {
		const onSelectSlide = mock();
		const document = assembleDocument({ title: "Grid storage", theme: "slate", cards: cards() });
		const view = render(
			<ViewerSlideCarousel
				{...carouselProps}
				deck={deckFromDocument(document)}
				onSelectSlide={onSelectSlide}
			/>,
		);

		fireEvent.click(view.getAllByRole("option")[1] as HTMLElement);
		expect(onSelectSlide).toHaveBeenCalledWith(1);
	});

	it("shows written cards and the planned point of cards still being drafted", () => {
		const [written] = cards();
		const preview: DraftPreview = {
			title: "Grid storage",
			entries: [
				{ position: 1, takeaway: "Storage is now cheap", layout: "title" },
				{ position: 2, takeaway: "Prices fell", layout: "stats" },
			],
			cards: { "1": written },
			assets: {},
			completed: 1,
			total: 2,
		};
		const view = render(
			<ViewerSlideCarousel
				{...carouselProps}
				deck={deckFromPreview(preview)}
				generation={{ stage: "drafting" }}
			/>,
		);

		const [first, second] = view.getAllByRole("option") as HTMLElement[];
		expect(within(first as HTMLElement).getByRole("article")).toHaveAccessibleName(
			"Card 1: Storage is now cheap",
		);
		expect(within(second as HTMLElement).queryByRole("article")).toBeNull();
		expect(within(second as HTMLElement).getByText("Prices fell")).toBeInTheDocument();
		expect(within(second as HTMLElement).getByText("Writing slides")).toBeInTheDocument();
	});
});
