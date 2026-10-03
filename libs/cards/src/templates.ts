import { assembleDocument, type CardDraftInput, convertCards } from "./convert";
import type { CardDocument, ThemeId } from "./schema";

/** Structurally compatible with CardView's asset map and the API's Asset JSON. */
export interface SampleAsset {
	mimeType: "image/jpeg";
	byteSize: number;
	width: number;
	height: number;
	url: string;
	source: {
		type: "stock";
		provider: "unsplash";
		providerId: string;
		photographer: string;
		photographerUrl: string;
		license: string;
	};
}

const OFFICE = "c3545bb15dae08598f306bffe69c1ecd1997d52d7c53552ef91b1bf06a7fd4b8";
const FOREST = "7d9f4da214f38d9f00185020ee84d3485e41291230f8db2b0be53a0eedb139cd";
const TEAM = "a9f55fe74dddfa672920e9086eb332bfae9a230ffc1a71d541cd4ebac86d91a7";

function photo(providerId: string, photographer: string, username: string): SampleAsset {
	return {
		mimeType: "image/jpeg",
		byteSize: 0,
		width: 1600,
		height: 1000,
		url: `https://images.unsplash.com/${providerId}?fm=jpg&fit=crop&w=1600&h=1000&q=85`,
		source: {
			type: "stock",
			provider: "unsplash",
			providerId,
			photographer,
			photographerUrl: `https://unsplash.com/@${username}?utm_source=slidesage&utm_medium=referral`,
			license: "https://unsplash.com/license",
		},
	};
}

/**
 * IDs follow API RemoteAsset semantics: SHA-256 of `provider:providerId`.
 * These are hotlinks, so byteSize is zero. Photos are already placed in image
 * nodes; previews only need this map, with no upload or image search step.
 * Saving requires registering assets for that presentation through the API.
 */
export const SAMPLE_ASSETS: Record<string, SampleAsset> = {
	[OFFICE]: photo("photo-1497366811353-6870744d04b2", "Nastuh Abootalebi", "nastuh"),
	[FOREST]: photo("photo-1441974231531-c6227db76b6e", "Sebastian Unrau", "sebastian_unrau"),
	[TEAM]: photo("photo-1519389950473-47ba0277781c", "Marvin Meyer", "marvelous"),
};

export const TEMPLATE_CATEGORIES = [
	{ id: "business", label: "Business", description: "Proposals, pitches and team updates." },
	{ id: "education", label: "Education", description: "Lessons and workshop outlines." },
	{ id: "creative", label: "Creative", description: "Portfolios and project stories." },
	{ id: "research", label: "Research", description: "Findings and technical briefings." },
] as const;
export type TemplateCategoryId = (typeof TEMPLATE_CATEGORIES)[number]["id"];

export interface TemplateDeck {
	document: CardDocument;
	assets: Record<string, SampleAsset>;
}

export interface CardTemplate extends TemplateDeck {
	id: string;
	name: string;
	description: string;
	category: TemplateCategoryId;
	tags: string[];
	theme: ThemeId;
	/** A real card ID for marketplace thumbnails. */
	previewCardId: string;
}

const heading = (text: string) => ({ type: "heading", text });
const paragraph = (text: string) => ({ type: "paragraph", text });
const image = (assetId: string, alt: string) => ({
	type: "image",
	assetId,
	alt,
	fit: "cover",
	focus: { x: 0.5, y: 0.5 },
});
const bullets = (...items: string[]) => ({ type: "bullets", items });
const steps = (...items: [string, string][]) => ({
	type: "steps",
	items: items.map(([title, detail]) => ({ title, detail })),
});
const columns = (...items: [string, string[]][]) => ({
	type: "columns",
	columns: items.map(([heading, items]) => ({ heading, items })),
});

function slide(
	layout: string,
	role: CardDraftInput["role"],
	takeaway: string,
	nodes: unknown[],
): Omit<CardDraftInput, "position"> {
	return {
		role,
		takeaway,
		draft: {
			layout,
			nodes,
			notes:
				"Starter content is illustrative. Replace claims and figures with your own evidence before presenting.",
		},
	};
}

function template(
	metadata: Omit<CardTemplate, "document" | "assets" | "previewCardId">,
	assetId: string,
	slides: Omit<CardDraftInput, "position">[],
): CardTemplate {
	const asset = SAMPLE_ASSETS[assetId];
	if (!asset) throw new Error(`Template ${metadata.id} has an unknown asset: ${assetId}`);
	const assets = { [assetId]: asset };
	const results = convertCards({
		operationId: `template-${metadata.id}`,
		sourceIds: [],
		assetIds: [assetId],
		cards: slides.map((card, index) => ({ ...card, position: index + 1 })),
	});
	const cards = results.map((result) => {
		if ("issue" in result) throw new Error(`Template ${metadata.id}: ${result.issue.message}`);
		return result.card;
	});
	const document = assembleDocument({
		title: metadata.name,
		theme: metadata.theme,
		cards,
		assetIds: [assetId],
	});
	const previewCardId = document.cardOrder[0];
	if (!previewCardId) throw new Error(`Template ${metadata.id} has no cards`);
	return { ...metadata, document, assets, previewCardId };
}

/** Six editable starter decks, each with a complete opening-to-closing story. */
export const CARD_TEMPLATES: CardTemplate[] = [
	template(
		{
			id: "ocean-proposal",
			name: "A better place to work",
			description: "A workspace proposal with tradeoffs, rollout and a clear decision.",
			category: "business",
			tags: ["proposal", "strategy"],
			theme: "ocean",
		},
		OFFICE,
		[
			slide("cover", "opening", "Make room for focused work", [
				image(OFFICE, "Sunlit office with shared desks and plants"),
				heading("A better place to work"),
				paragraph("A workspace proposal for the next chapter of our team."),
			]),
			slide("image-right", "context", "Design the office around how people work", [
				heading("Focus needs a place"),
				paragraph(
					"Our next workspace should support quiet thinking as well as collaboration. Start with the work, then choose the rooms.",
				),
				image(OFFICE, "Shared office with distinct work areas"),
			]),
			slide("comparison", "comparison", "Balance dedicated space with flexibility", [
				heading("Two ways to make room"),
				columns(
					[
						"Fixed desks",
						["A predictable home for each person", "Less room for changing team sizes"],
					],
					[
						"Shared neighborhoods",
						["Space follows project needs", "Needs clear booking and storage rules"],
					],
				),
			]),
			slide("process", "process", "Test the plan before signing a lease", [
				heading("Try it before we commit"),
				steps(
					["Observe", "Map a week of actual work."],
					["Pilot", "Test quiet zones and shared desks."],
					["Decide", "Compare usage, cost and feedback."],
				),
			]),
			slide("title", "closing", "Approve a four-week workspace pilot", [
				heading("Start with a four-week pilot"),
				paragraph(
					"Agree on an owner, a budget and the measures that will guide the final decision.",
				),
			]),
		],
	),
	template(
		{
			id: "grove-lesson",
			name: "How a forest works",
			description: "A short ecology lesson with a discussion prompt and field activity.",
			category: "education",
			tags: ["lesson", "nature"],
			theme: "grove",
		},
		FOREST,
		[
			slide("cover", "opening", "A forest is a connected system", [
				image(FOREST, "Sunlight filtering through a green forest"),
				heading("How a forest works"),
				paragraph("Look beyond individual trees to the systems that support them."),
			]),
			slide("image-left", "context", "Life occupies every layer of the forest", [
				image(FOREST, "Tall trees and a shaded forest floor"),
				heading("Life at every level"),
				bullets(
					"The canopy captures sunlight.",
					"The understory shelters young plants.",
					"The forest floor recycles organic matter.",
				),
			]),
			slide("bullets", "insight", "Trace the connections between organisms", [
				heading("Follow the connections"),
				bullets(
					"Which organisms depend on the same food source?",
					"Where does water collect after rain?",
					"What changes when one large tree falls?",
				),
			]),
			slide("process", "process", "Observe, record and compare a small patch", [
				heading("A field activity"),
				steps(
					["Choose", "Pick a small patch of woodland."],
					["Record", "Sketch its layers and signs of life."],
					["Compare", "Discuss what differs in another patch."],
				),
			]),
			slide("title", "closing", "Explain one connection you observed", [
				heading("What depends on what?"),
				paragraph(
					"Share one relationship you observed and explain what might happen if it changed.",
				),
			]),
		],
	),
	template(
		{
			id: "orchid-portfolio",
			name: "From brief to brand",
			description: "A design case study covering the brief, direction and delivery.",
			category: "creative",
			tags: ["portfolio", "case study"],
			theme: "orchid",
		},
		TEAM,
		[
			slide("cover", "opening", "Turn a scattered identity into a usable brand", [
				image(TEAM, "Design team working together around a table"),
				heading("From brief to brand"),
				paragraph("A design case study for a small team with a growing audience."),
			]),
			slide("image-right", "context", "The team needs one recognizable visual language", [
				heading("The brief"),
				paragraph(
					"Bring the website, launch materials and everyday documents into one visual language. Keep the system simple enough for a small team to maintain.",
				),
				image(TEAM, "Collaborators reviewing work at a shared table"),
			]),
			slide("comparison", "comparison", "Replace disconnected choices with a repeatable system", [
				heading("Before and after"),
				columns(
					[
						"Before",
						["Different type choices on each channel", "Layouts rebuilt for every launch"],
					],
					[
						"After",
						["A shared type scale and image treatment", "Reusable layouts with clear rules"],
					],
				),
			]),
			slide("process", "process", "Move from research to a usable toolkit", [
				heading("How we got there"),
				steps(
					["Listen", "Audit the work and interview the team."],
					["Explore", "Test two directions with real content."],
					["Deliver", "Package templates and usage examples."],
				),
			]),
			slide("title", "closing", "A brand system should be easy to use", [
				heading("Make the next project easier"),
				paragraph(
					"Show the final work here, then explain how the team uses the toolkit without a designer in every meeting.",
				),
			]),
		],
	),
	template(
		{
			id: "sand-workshop",
			name: "A workshop that leads to action",
			description: "A facilitation deck with goals, discussion and an action plan.",
			category: "education",
			tags: ["workshop", "teamwork"],
			theme: "sand",
		},
		OFFICE,
		[
			slide("cover", "opening", "Leave the workshop with a decision", [
				image(OFFICE, "Open workspace ready for a team session"),
				heading("A workshop that leads to action"),
				paragraph("A practical session for choosing what the team should do next."),
			]),
			slide("bullets", "context", "Set a shared goal before discussing solutions", [
				heading("What we need from today"),
				bullets(
					"Agree on the problem we are solving.",
					"Choose one change we can test.",
					"Name an owner and a review date.",
				),
			]),
			slide("quote", "insight", "Specific questions produce useful discussions", [
				{
					type: "quote",
					text: "What is one thing we could change this week that would make next week easier?",
					attribution: "Discussion prompt",
				},
			]),
			slide("process", "process", "Give everyone time to think before deciding", [
				heading("The session plan"),
				steps(
					["Think", "Write ideas silently for five minutes."],
					["Discuss", "Group ideas and examine the tradeoffs."],
					["Choose", "Select one experiment and its owner."],
				),
			]),
			slide("title", "closing", "Record the action, owner and review date", [
				heading("One action, one owner"),
				paragraph(
					"Write the commitment here. Include when the team will review the result and what evidence it needs.",
				),
			]),
		],
	),
	template(
		{
			id: "cobalt-launch",
			name: "Meet the next release",
			description: "A product launch pitch with benefits, sample metrics and rollout.",
			category: "business",
			tags: ["product", "launch"],
			theme: "cobalt",
		},
		TEAM,
		[
			slide("cover", "opening", "Help teams move from requests to decisions", [
				image(TEAM, "Product team working on laptops"),
				heading("Meet the next release"),
				paragraph("Less chasing updates. More time to make the call."),
			]),
			slide("image-left", "context", "Keep a request and its decision in one place", [
				image(TEAM, "Team collaborating on a product launch"),
				heading("A clearer path to a decision"),
				paragraph(
					"Give every request an owner, a visible status and the context needed to decide. The next release puts those details together.",
				),
			]),
			slide("stats", "evidence", "Measure the pilot against explicit targets", [
				heading("Pilot targets"),
				{ type: "stat", value: "20%", label: "Target reduction in follow-up messages" },
				{ type: "stat", value: "2 weeks", label: "Planned pilot duration" },
				paragraph(
					"Illustrative targets, not measured results. Replace these with your own baseline and goals.",
				),
			]),
			slide("process", "process", "Expand only after the pilot meets its goals", [
				heading("Roll out with evidence"),
				steps(
					["Invite", "Start with one team and a baseline."],
					["Learn", "Track friction and review usage."],
					["Expand", "Roll out after the pilot review."],
				),
			]),
			slide("title", "closing", "Choose a team for the pilot", [
				heading("Who should try it first?"),
				paragraph(
					"Name the pilot team and the person who will collect feedback. Set a date for the first review.",
				),
			]),
		],
	),
	template(
		{
			id: "mono-briefing",
			name: "A system we can trust",
			description: "A technical briefing with architecture tradeoffs and a migration plan.",
			category: "research",
			tags: ["technical", "architecture"],
			theme: "mono",
		},
		TEAM,
		[
			slide("title", "opening", "Make reliability a property of the system", [
				heading("A system we can trust"),
				paragraph("A technical briefing on making background jobs observable and safe to retry."),
			]),
			slide("image-right", "context", "A retry must not repeat a completed side effect", [
				heading("The failure we need to handle"),
				paragraph(
					"A worker can finish a job and lose its connection before acknowledging it. A retry should find the completed result rather than apply the same change again.",
				),
				image(TEAM, "Engineers reviewing work together"),
			]),
			slide("comparison", "comparison", "Choose the consistency model deliberately", [
				heading("Two approaches to retries"),
				columns(
					[
						"Best effort",
						["Simple workers and low coordination", "Duplicate effects require cleanup"],
					],
					[
						"Idempotent jobs",
						["Stable keys identify completed work", "State transitions need explicit rules"],
					],
				),
			]),
			slide("process", "process", "Migrate in steps that can be measured", [
				heading("A measured migration"),
				steps(
					["Instrument", "Record attempts, results and latency."],
					["Protect", "Add stable keys to side effects."],
					["Verify", "Test recovery before wider rollout."],
				),
			]),
			slide("title", "closing", "Review the design with a real failure scenario", [
				heading("Walk through the failure"),
				paragraph(
					"Pick one job. Show what happens if the worker stops before, during and after its side effect.",
				),
			]),
		],
	),
];

export function getCardTemplate(id: string): CardTemplate | undefined {
	return CARD_TEMPLATES.find((template) => template.id === id);
}

/** Each editor gets its own document and asset metadata, without mutating the catalog. */
export function createTemplateDeck(id: string): TemplateDeck {
	const template = getCardTemplate(id);
	if (!template) throw new RangeError(`Unknown card template: ${id}`);
	return structuredClone({ document: template.document, assets: template.assets });
}
