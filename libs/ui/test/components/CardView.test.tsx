import { describe, expect, it } from "bun:test";
import {
	assembleDocument,
	CARD_TEMPLATES,
	CARD_THEME_DEFINITIONS,
	type Card,
	convertCards,
} from "@slidesage/cards";
import { render, within } from "@testing-library/react";
import { fitTextScale, MIN_TEXT_SCALE } from "../../components/Cards/CardView";
import { CardList } from "../CardList";

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

describe("CardView", () => {
	it("renders catalog decks using their shared theme tokens and pre-placed photos", () => {
		for (const template of CARD_TEMPLATES) {
			const view = render(<CardList document={template.document} assets={template.assets} />);
			const articles = view.getAllByRole("article");
			const definition = CARD_THEME_DEFINITIONS[template.theme];
			expect(articles).toHaveLength(5);
			for (const article of articles) {
				expect(article.style.getPropertyValue("--card-surface")).toBe(definition.palette.surface);
				expect(article.style.getPropertyValue("--card-heading-font")).toBe(
					definition.fonts.heading.cssFamily,
				);
			}
			for (const img of view.getAllByRole("img")) {
				expect(img.getAttribute("src")).toBe(Object.values(template.assets)[0]?.url ?? null);
			}
			expect(view.getAllByText(/Photo by/).length).toBeGreaterThan(0);
			view.unmount();
		}
	});
	it("renders every card in order with its layout content", () => {
		const document = assembleDocument({ title: "Grid storage", theme: "paper", cards: cards() });
		const view = render(
			<CardList
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
			<CardList
				document={document}
				sources={[{ url: "https://example.com/report", title: "Battery report" }]}
			/>,
		);

		const citation = view.getByRole("link", { name: "[1]" });
		expect(citation).toHaveAttribute("href", "https://example.com/report");
		expect(citation).toHaveAttribute("rel", "noreferrer noopener");
	});
});

describe("image cards", () => {
	const assetId = "b".repeat(64);
	const results = convertCards({
		operationId: "images",
		sourceIds: [],
		assetIds: [assetId],
		cards: [
			{
				position: 1,
				takeaway: "Storage at scale",
				role: "evidence",
				draft: {
					layout: "image-right",
					nodes: [
						{ type: "image", assetId, alt: "Battery racks" },
						{ type: "heading", text: "Storage at scale" },
						{ type: "paragraph", text: "Warehouses of cells back up the grid." },
					],
				},
			},
			{
				position: 2,
				takeaway: "A new grid",
				role: "closing",
				draft: {
					layout: "cover",
					nodes: [
						{ type: "image", assetId, alt: "City at night" },
						{ type: "heading", text: "A new grid" },
					],
				},
			},
		],
	});
	const imageCards = results.map((result) => {
		if (!("card" in result)) throw new Error(result.issue.message);
		return result.card;
	});

	it("shows the stored photo with its credit", () => {
		const document = assembleDocument({
			title: "Grid storage",
			theme: "slate",
			cards: imageCards,
			assetIds: [assetId],
		});
		const view = render(
			<CardList
				document={document}
				assetUrl={(id) => `/assets/${id}`}
				assets={{
					[assetId]: {
						mimeType: "image/jpeg",
						width: 1600,
						height: 900,
						source: {
							type: "stock",
							provider: "pexels",
							photographer: "Ada",
							photographerUrl: "https://www.pexels.com/@ada",
							pageUrl: "https://www.pexels.com/photo/1",
						},
					},
				}}
			/>,
		);

		const photo = view.getByRole("img", { name: "Battery racks" });
		expect(photo).toHaveAttribute("src", `/assets/${assetId}`);
		expect(photo).toHaveStyle({ objectFit: "cover" });
		expect(view.getAllByRole("link", { name: "Pexels" })[0]).toHaveAttribute(
			"href",
			"https://www.pexels.com",
		);
		const [split, cover] = view.getAllByRole("article");
		expect(split).toHaveAttribute("data-layout", "image-right");
		expect(
			within(cover as HTMLElement).getByRole("img", { name: "City at night" }),
		).toBeInTheDocument();
	});

	it("shows a hotlinked photo from its library with a linked credit", () => {
		const document = assembleDocument({
			title: "Grid storage",
			theme: "slate",
			cards: imageCards,
			assetIds: [assetId],
		});
		const hotlink = "https://images.unsplash.com/photo-1?w=2400";
		const view = render(
			<CardList
				document={document}
				assetUrl={(id) => `/assets/${id}`}
				assets={{
					[assetId]: {
						mimeType: "image/jpeg",
						width: 2400,
						height: 1350,
						url: hotlink,
						source: {
							type: "stock",
							provider: "unsplash",
							photographer: "Ada",
							photographerUrl: "https://unsplash.com/@ada?utm_source=slidesage&utm_medium=referral",
						},
					},
				}}
			/>,
		);

		expect(view.getByRole("img", { name: "Battery racks" })).toHaveAttribute("src", hotlink);
		expect(view.getAllByRole("link", { name: "Unsplash" })[0]).toHaveAttribute(
			"href",
			"https://unsplash.com/?utm_source=slidesage&utm_medium=referral",
		);
	});
});

describe("fitTextScale", () => {
	/** A content box whose content is `natural` tall at full size and shrinks with --fit. */
	function measuredBox(natural: number, available: number) {
		const target = document.createElement("div");
		const box = document.createElement("div");
		Object.defineProperty(box, "clientHeight", { value: available });
		Object.defineProperty(box, "scrollHeight", {
			get: () => natural * Number(target.style.getPropertyValue("--fit") || 1),
		});
		return { target, box };
	}

	it("keeps content at full size when it fits the slide", () => {
		const { target, box } = measuredBox(500, 600);
		expect(fitTextScale(target, box)).toBe(1);
		expect(target.style.getPropertyValue("--fit")).toBe("1");
	});

	it("shrinks content until it fits, and no further", () => {
		const { target, box } = measuredBox(1000, 600);
		const scale = fitTextScale(target, box);
		expect(scale).toBeLessThanOrEqual(0.601);
		expect(scale).toBeGreaterThan(0.59);
		expect(Number(target.style.getPropertyValue("--fit"))).toBe(scale);
	});

	it("stops at half size, as PPTX export does", () => {
		const { target, box } = measuredBox(5000, 600);
		expect(fitTextScale(target, box)).toBe(MIN_TEXT_SCALE);
	});
});
