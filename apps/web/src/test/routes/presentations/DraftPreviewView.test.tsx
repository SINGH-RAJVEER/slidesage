/// <reference lib="dom" />

import { describe, expect, it } from "bun:test";
import { convertCards } from "@slidesage/cards";
import { render, within } from "@testing-library/react";
import { DraftPreviewView } from "../../../routes/presentations/DraftPreviewView";

function drafted() {
	const [result] = convertCards({
		operationId: "preview",
		sourceIds: [],
		cards: [
			{
				position: 1,
				takeaway: "Storage is scaling fast",
				role: "opening",
				draft: { layout: "title", nodes: [{ type: "heading", text: "Grid storage" }] },
			},
		],
	});
	if (!result || !("card" in result)) throw new Error("fixture");
	return result.card;
}

describe("DraftPreviewView", () => {
	it("shows written cards and the points of cards still being written", () => {
		const view = render(
			<DraftPreviewView
				preview={{
					title: "Grid storage",
					entries: [
						{ position: 1, takeaway: "Storage is scaling fast", layout: "title" },
						{ position: 2, takeaway: "Costs fell by half", layout: "stats" },
					],
					cards: { "1": drafted() },
					assets: {},
					completed: 1,
					total: 2,
				}}
				assetUrl={(id) => `/assets/${id}`}
				message="Writing cards"
				percent={50}
				onCancel={() => {}}
			/>,
		);

		expect(view.getByText("Writing cards · 1 of 2 cards written")).toBeInTheDocument();
		// The deck title and the written card's heading.
		expect(view.getAllByText("Grid storage")).toHaveLength(2);
		const pending = view.getByRole("list", { name: "Cards being written" });
		expect(within(pending).getByText("Costs fell by half")).toBeInTheDocument();
		expect(within(pending).queryByText("Storage is scaling fast")).toBeNull();
	});
});
