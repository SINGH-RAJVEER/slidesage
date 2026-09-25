import { describe, expect, it } from "bun:test";
import { assembleDocument, type Card, convertCards } from "@slidesage/cards";
import { render, within } from "@testing-library/react";
import { CardDeck } from "../../components/Cards";

function cards(): Card[] {
	const results = convertCards({
		operationId: "fixture",
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
			{
				position: 3,
				takeaway: "Options differ",
				role: "comparison",
				draft: {
					layout: "comparison",
					nodes: [
						{ type: "heading", text: "Two approaches" },
						{
							type: "columns",
							columns: [
								{ heading: "Lithium", items: ["Fast response", "Short duration"] },
								{ heading: "Pumped hydro", items: ["Long duration", "Site limited"] },
							],
						},
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

describe("CardDeck", () => {
	it("renders every card in order with its layout content", () => {
		const document = assembleDocument({ title: "Grid storage", theme: "paper", cards: cards() });
		const view = render(
			<CardDeck
				document={document}
				sources={[{ url: "https://example.com/report", title: "Battery report" }]}
			/>,
		);

		const articles = view.getAllByRole("article");
		expect(articles).toHaveLength(3);
		expect(articles[0]).toHaveAccessibleName("Card 1: Storage is now cheap");
		expect(within(articles[0] as HTMLElement).getByText("storage").tagName).toBe("STRONG");
		expect(within(articles[1] as HTMLElement).getByText("-89%")).toBeInTheDocument();
		expect(within(articles[2] as HTMLElement).getByText("Pumped hydro")).toBeInTheDocument();
	});

	it("links a card's citations to the research sources", () => {
		const document = assembleDocument({ title: "Grid storage", theme: "slate", cards: cards() });
		const view = render(
			<CardDeck
				document={document}
				sources={[{ url: "https://example.com/report", title: "Battery report" }]}
			/>,
		);

		const citation = view.getByRole("link", { name: "[1]" });
		expect(citation).toHaveAttribute("href", "https://example.com/report");
		expect(citation).toHaveAttribute("rel", "noreferrer noopener");
	});
});
