/// <reference lib="dom" />

import { afterEach, describe, expect, it } from "bun:test";
import { convertCards } from "@slidesage/cards";
import type { ViewerDeck } from "@slidesage/ui/components/Viewer";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DeckViewer } from "../../../routes/presentations/DeckViewer";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function stubScrollIntoView(value: (this: HTMLElement) => void) {
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value });
}

afterEach(() => {
	stubScrollIntoView(originalScrollIntoView);
});

const takeaways = ["Storage is now cheap", "Grids need flexibility", "Batteries fill the gap"];

function card(position: number) {
	const [result] = convertCards({
		operationId: "viewer",
		sourceIds: [],
		cards: [
			{
				position,
				takeaway: takeaways[position - 1] ?? "",
				role: position === 1 ? "opening" : "insight",
				draft: { layout: "title", nodes: [{ type: "heading", text: `Card ${position}` }] },
			},
		],
	});
	if (!result || !("card" in result)) throw new Error("fixture card is invalid");
	return result.card;
}

/** A drafting deck whose first `written` slots have cards. */
function drafting(written: number): ViewerDeck {
	return {
		title: "Grid storage",
		theme: "slate",
		slides: takeaways.map((takeaway, index) =>
			index < written
				? { key: `position-${index + 1}`, card: card(index + 1) }
				: { key: `position-${index + 1}`, takeaway },
		),
	};
}

function viewer(deck: ViewerDeck) {
	return (
		<MemoryRouter>
			<DeckViewer title="Grid storage" deck={deck} onBack={() => {}} isWaiting />
		</MemoryRouter>
	);
}

/** Records the slides the viewer scrolls to. */
function recordScrolls() {
	const scrolled: string[] = [];
	stubScrollIntoView(function (this: HTMLElement) {
		scrolled.push(this.id);
	});
	return scrolled;
}

describe("DeckViewer", () => {
	it("moves to each card as it streams in", () => {
		const scrolled = recordScrolls();

		const view = render(viewer(drafting(0)));
		expect(scrolled).toEqual([]);

		view.rerender(viewer(drafting(1)));
		expect(scrolled).toEqual(["slide-0"]);

		view.rerender(viewer(drafting(3)));
		expect(scrolled).toEqual(["slide-0", "slide-2"]);
	});

	it("stays on a slide the viewer picks while cards stream in", () => {
		const scrolled = recordScrolls();

		const view = render(viewer(drafting(1)));
		fireEvent.click(view.getByRole("button", { name: "Go to slide 2" }));
		expect(scrolled).toEqual(["slide-0", "slide-1"]);

		view.rerender(viewer(drafting(3)));
		expect(scrolled).toEqual(["slide-0", "slide-1"]);
	});
});
