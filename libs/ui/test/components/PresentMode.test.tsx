import { describe, expect, it, mock } from "bun:test";
import { assembleDocument, type Card, convertCards } from "@slidesage/cards";
import { fireEvent, render } from "@testing-library/react";
import { PresentMode } from "../../components/Cards";

function deck() {
	const results = convertCards({
		operationId: "present",
		sourceIds: [],
		cards: ["First point", "Second point", "Third point"].map((heading, index) => ({
			position: index + 1,
			takeaway: heading,
			role: index === 0 ? "opening" : "insight",
			draft: {
				layout: index === 0 ? "title" : "statement",
				nodes: [
					{ type: "heading", text: heading },
					...(index === 0
						? []
						: [{ type: "paragraph", text: `Why the ${heading.toLowerCase()} matters.` }]),
				],
				...(index === 1 ? { notes: "Pause here for questions." } : {}),
			},
		})),
	});
	const cards = results.map((result) => {
		if (!("card" in result)) throw new Error(result.issue.message);
		return result.card as Card;
	});
	return assembleDocument({ title: "Grid storage", theme: "slate", cards });
}

describe("PresentMode", () => {
	it("moves between cards with the keyboard and shows notes on N", () => {
		const view = render(<PresentMode document={deck()} onExit={() => {}} />);

		expect(view.getByRole("article", { name: /Card 1: First point/ })).toBeInTheDocument();
		expect(view.getByText("1 / 3")).toBeInTheDocument();

		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(view.getByRole("article", { name: /Card 2: Second point/ })).toBeInTheDocument();
		expect(view.queryByRole("article", { name: /Card 1/ })).toBeNull();

		fireEvent.keyDown(window, { key: "n" });
		expect(view.getByRole("region", { name: "Speaker notes" })).toHaveTextContent(
			"Pause here for questions.",
		);

		fireEvent.keyDown(window, { key: "End" });
		expect(view.getByText("3 / 3")).toBeInTheDocument();
		expect(view.getByRole("button", { name: "Next card" })).toBeDisabled();
		fireEvent.keyDown(window, { key: " " });
		expect(view.getByText("3 / 3")).toBeInTheDocument();

		fireEvent.keyDown(window, { key: "Home" });
		expect(view.getByText("1 / 3")).toBeInTheDocument();
	});

	it("leaves on Escape", () => {
		const onExit = mock(() => {});
		render(<PresentMode document={deck()} start={1} onExit={onExit} />);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onExit).toHaveBeenCalledTimes(1);
	});
});
