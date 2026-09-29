import {
	assembleDocument,
	type Card,
	type CardDraftInput,
	convertCards,
	type NarrativeRole,
	type ThemeId,
} from "@slidesage/cards";

/**
 * A plate orbiting the wordmark: one card of a sample deck, drawn with the
 * same card renderer the viewer uses, so the landing page shows exactly what
 * SlideSage makes and ships no images of its own.
 */
export interface LandingPlate {
	/** Stable identity of this card, unique across the pool. */
	key: string;
	/** Title of the sample deck the card belongs to. */
	deck: string;
	theme: ThemeId;
	card: Card;
	/** One-based, in deck order. */
	position: number;
}

/**
 * Plates on the ring at once, on a screen wide enough to hold them.
 *
 * Well past what a single ellipse would hold end to end, which is why the hero
 * spreads them into a belt rather than seating them on one line.
 */
export const LANDING_PLATE_COUNT = 30;

/**
 * Plates the ring carries at a given viewport width.
 *
 * The ring's radius scales with the viewport, so a phone's ring is a third the
 * size of a desktop's while a plate stays the same fraction of it. A crowd
 * sized for the desktop belt lands on a phone as a cluster of specks, so the
 * count steps down with the width that has to hold it.
 */
export function landingPlateCount(viewportWidth: number): number {
	if (viewportWidth < 640) return 10;
	if (viewportWidth < 1024) return 18;
	return LANDING_PLATE_COUNT;
}

type SampleCard = [NarrativeRole, string, Record<string, unknown>];

interface SampleDeck {
	title: string;
	theme: ThemeId;
	cards: SampleCard[];
}

const heading = (text: string) => ({ type: "heading", text });
const paragraph = (text: string) => ({ type: "paragraph", text });

/* Written in the draft format the model writes, and converted by the same
   converter, so a sample that stops fitting the schema fails its test. */
const SAMPLE_DECKS: SampleDeck[] = [
	{
		title: "Grid-scale storage",
		theme: "slate",
		cards: [
			[
				"opening",
				"Storage is now cheap",
				{
					layout: "title",
					nodes: [
						heading("Grid **storage** comes of age"),
						paragraph("What falling battery prices mean for the next decade of power"),
					],
				},
			],
			[
				"evidence",
				"Prices fell fast",
				{
					layout: "stats",
					nodes: [
						heading("Costs fell faster than forecast"),
						{ type: "stat", value: "-89%", label: "Pack price since 2010" },
						{ type: "stat", value: "$139", label: "Per kWh in 2023" },
						{ type: "stat", value: "42 GW", label: "Added last year" },
					],
				},
			],
			[
				"comparison",
				"Options differ",
				{
					layout: "comparison",
					nodes: [
						heading("Two ways to hold a grid steady"),
						{
							type: "columns",
							columns: [
								{
									heading: "Lithium-ion",
									items: ["Responds in milliseconds", "Four hours or less"],
								},
								{ heading: "Pumped hydro", items: ["Runs for days", "Needs the right valley"] },
							],
						},
					],
				},
			],
			[
				"process",
				"Projects follow four steps",
				{
					layout: "process",
					nodes: [
						heading("From permit to power"),
						{
							type: "steps",
							items: [
								{ title: "Site", detail: "Near a substation" },
								{ title: "Connect", detail: "Queue for the grid" },
								{ title: "Build", detail: "Containers, not concrete" },
								{ title: "Dispatch", detail: "Charge low, sell high" },
							],
						},
					],
				},
			],
			[
				"insight",
				"Storage changes the peak",
				{
					layout: "statement",
					nodes: [
						heading("The evening peak is now a design choice"),
						paragraph(
							"Solar at noon, released at seven. Storage turns cheap daytime power into the most valuable hour of the day.",
						),
					],
				},
			],
			[
				"closing",
				"Plan for storage first",
				{
					layout: "bullets",
					nodes: [
						heading("What to do next"),
						{
							type: "bullets",
							items: [
								"Model storage in every new plant",
								"Price flexibility, not capacity",
								"Retire peakers on a schedule",
							],
						},
					],
				},
			],
		],
	},
	{
		title: "Remote work, measured",
		theme: "paper",
		cards: [
			[
				"opening",
				"Remote work is settled",
				{
					layout: "title",
					nodes: [
						heading("Remote work, *measured*"),
						paragraph("Four years of data from 1,200 teams"),
					],
				},
			],
			[
				"evidence",
				"Output held up",
				{
					layout: "stats",
					nodes: [
						heading("Output held; commutes did not"),
						{ type: "stat", value: "+4%", label: "Tasks shipped per person" },
						{ type: "stat", value: "72 min", label: "Saved each day" },
					],
				},
			],
			[
				"context",
				"Meetings expanded",
				{
					layout: "bullets",
					nodes: [
						heading("Where the time went"),
						{
							type: "bullets",
							items: [
								"Meetings grew by a third",
								"Chat replaced hallway questions",
								"Focus blocks became rare",
							],
						},
					],
				},
			],
			[
				"insight",
				"Writing wins",
				{
					layout: "quote",
					nodes: [
						{
							type: "quote",
							text: "The teams that wrote things down stopped needing the meeting.",
							attribution: "Engineering lead, survey response",
						},
					],
				},
			],
			[
				"comparison",
				"Hybrid needs rules",
				{
					layout: "comparison",
					nodes: [
						heading("Hybrid by default or by design"),
						{
							type: "columns",
							columns: [
								{ heading: "By default", items: ["Empty office days", "Uneven meetings"] },
								{ heading: "By design", items: ["Anchor days", "Remote-first rituals"] },
							],
						},
					],
				},
			],
			[
				"closing",
				"Set anchor days",
				{
					layout: "statement",
					nodes: [
						heading("Pick two anchor days"),
						paragraph(
							"Bring people together on purpose, and protect the other three for deep work.",
						),
					],
				},
			],
		],
	},
	{
		title: "Launching in a new market",
		theme: "ember",
		cards: [
			[
				"opening",
				"We are ready to launch",
				{
					layout: "title",
					nodes: [
						heading("Going to **Lisbon**"),
						paragraph("A launch plan for our first market abroad"),
					],
				},
			],
			[
				"evidence",
				"Demand is there",
				{
					layout: "stats",
					nodes: [
						heading("The demand is already here"),
						{ type: "stat", value: "18k", label: "Waitlist sign-ups" },
						{ type: "stat", value: "3.1x", label: "Search growth" },
						{ type: "stat", value: "0", label: "Local competitors" },
					],
				},
			],
			[
				"process",
				"Launch in stages",
				{
					layout: "process",
					nodes: [
						heading("Ninety days to launch"),
						{
							type: "steps",
							items: [
								{ title: "Hire", detail: "A local lead" },
								{ title: "Localise", detail: "Product and support" },
								{ title: "Pilot", detail: "Two hundred customers" },
								{ title: "Open", detail: "Public launch" },
							],
						},
					],
				},
			],
			[
				"context",
				"Risks are known",
				{
					layout: "bullets",
					nodes: [
						heading("Risks we are planning for"),
						{
							type: "bullets",
							items: ["Payments rules differ", "Support hours stretch", "Pricing needs testing"],
						},
					],
				},
			],
			[
				"insight",
				"Start small",
				{
					layout: "statement",
					nodes: [
						heading("Win one city first"),
						paragraph(
							"A dense, loyal base in Lisbon is worth more than a thin launch across the country.",
						),
					],
				},
			],
			[
				"closing",
				"Approve the pilot",
				{
					layout: "title",
					nodes: [heading("Approve the pilot"), paragraph("Budget, hire, and a date in March")],
				},
			],
		],
	},
	{
		title: "How coral reefs recover",
		theme: "slate",
		cards: [
			[
				"opening",
				"Reefs can recover",
				{
					layout: "title",
					nodes: [
						heading("How **coral reefs** recover"),
						paragraph("Field notes from a decade of restoration"),
					],
				},
			],
			[
				"evidence",
				"Bleaching is frequent",
				{
					layout: "stats",
					nodes: [
						heading("Bleaching now comes every few years"),
						{ type: "stat", value: "6 yrs", label: "Between events, down from 25" },
						{ type: "stat", value: "14%", label: "Of reef lost since 2009" },
					],
				},
			],
			[
				"process",
				"Restoration has steps",
				{
					layout: "process",
					nodes: [
						heading("Growing a reef back"),
						{
							type: "steps",
							items: [
								{ title: "Collect", detail: "Heat-tolerant fragments" },
								{ title: "Nurse", detail: "Grow on underwater trees" },
								{ title: "Plant", detail: "Fix to bare rock" },
							],
						},
					],
				},
			],
			[
				"insight",
				"Fish drive recovery",
				{
					layout: "quote",
					nodes: [
						heading("What the divers saw"),
						{
							type: "quote",
							text: "Where the parrotfish came back, the coral followed within two seasons.",
							attribution: "Restoration survey, 2024",
						},
					],
				},
			],
			[
				"closing",
				"Protect the grazers",
				{
					layout: "bullets",
					nodes: [
						heading("Three things that work"),
						{
							type: "bullets",
							items: ["Protect grazing fish", "Plant resilient corals", "Cut runoff at the source"],
						},
					],
				},
			],
		],
	},
	{
		title: "Onboarding that sticks",
		theme: "paper",
		cards: [
			[
				"opening",
				"Onboarding decides retention",
				{
					layout: "title",
					nodes: [
						heading("Onboarding that *sticks*"),
						paragraph("Why the first week decides the first year"),
					],
				},
			],
			[
				"evidence",
				"Early wins retain",
				{
					layout: "stats",
					nodes: [
						heading("The first week predicts the first year"),
						{ type: "stat", value: "2.4x", label: "Retention with a first-week win" },
						{ type: "stat", value: "58%", label: "Leave before month six" },
					],
				},
			],
			[
				"comparison",
				"Buddies beat binders",
				{
					layout: "comparison",
					nodes: [
						heading("Binders or buddies"),
						{
							type: "columns",
							columns: [
								{ heading: "Binder", items: ["Read everything", "Ask no one"] },
								{ heading: "Buddy", items: ["Ship on day three", "Ask anyone"] },
							],
						},
					],
				},
			],
			[
				"process",
				"A four-week plan",
				{
					layout: "process",
					nodes: [
						heading("The first month"),
						{
							type: "steps",
							items: [
								{ title: "Week 1", detail: "Ship something small" },
								{ title: "Week 2", detail: "Meet every team" },
								{ title: "Week 3", detail: "Own a real task" },
								{ title: "Week 4", detail: "Set goals together" },
							],
						},
					],
				},
			],
			[
				"closing",
				"Start with a buddy",
				{
					layout: "statement",
					nodes: [
						heading("Give every hire a buddy"),
						paragraph("One named person, one small first task, and a check-in every Friday."),
					],
				},
			],
		],
	},
	{
		title: "The printing press",
		theme: "ember",
		cards: [
			[
				"opening",
				"Print changed everything",
				{
					layout: "title",
					nodes: [heading("The **printing press**"), paragraph("How movable type remade Europe")],
				},
			],
			[
				"evidence",
				"Books multiplied",
				{
					layout: "stats",
					nodes: [
						heading("Books became ordinary"),
						{ type: "stat", value: "20M", label: "Books printed by 1500" },
						{ type: "stat", value: "270", label: "Cities with a press" },
					],
				},
			],
			[
				"context",
				"Ideas spread",
				{
					layout: "bullets",
					nodes: [
						heading("What spread with the books"),
						{
							type: "bullets",
							items: ["Standard spelling", "Scientific journals", "Pamphlets and dissent"],
						},
					],
				},
			],
			[
				"insight",
				"Speed mattered",
				{
					layout: "quote",
					nodes: [
						{
							type: "quote",
							text: "What once took a scribe a year, a press could make in a week.",
							attribution: "Historian of the book",
						},
					],
				},
			],
			[
				"closing",
				"Every medium repeats this",
				{
					layout: "statement",
					nodes: [
						heading("Every new medium repeats the story"),
						paragraph("Cheaper copies, more voices, and a scramble to decide who is trusted."),
					],
				},
			],
		],
	},
];

function convertDeck(deck: SampleDeck, index: number): LandingPlate[] {
	const inputs: CardDraftInput[] = deck.cards.map(([role, takeaway, draft], position) => ({
		position: position + 1,
		takeaway,
		role,
		draft,
	}));
	const cards = convertCards({ operationId: `landing-${index}`, sourceIds: [], cards: inputs }).map(
		(result) => {
			if (!("card" in result)) throw new Error(`${deck.title}: ${result.issue.message}`);
			return result.card;
		},
	);
	const document = assembleDocument({ title: deck.title, theme: deck.theme, cards });
	return document.cardOrder.flatMap((cardId, position) => {
		const card = document.cards[cardId];
		return card
			? [{ key: cardId, deck: document.title, theme: document.theme, card, position: position + 1 }]
			: [];
	});
}

/** Every sample card, converted and validated once. */
export const LANDING_CARDS: readonly LandingPlate[] = SAMPLE_DECKS.flatMap(convertDeck);

function shuffle<T>(values: T[], random: () => number): T[] {
	for (let index = values.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		const held = values[index];
		const other = values[swap];
		if (held !== undefined && other !== undefined) {
			values[index] = other;
			values[swap] = held;
		}
	}
	return values;
}

/**
 * Draws the plates for one visit.
 *
 * Decks and their cards are both shuffled, then taken one card per deck per
 * round. Round-robin rather than a flat shuffle because the opening entries
 * are what the ring shows first: taking a round at a time shows every deck
 * before a second card of any of them, where a flat shuffle would regularly
 * seat three cards of one deck side by side.
 *
 * `random` is injectable so tests can pin the draw.
 */
export function randomLandingPool(random: () => number = Math.random): LandingPlate[] {
	const decks = shuffle(
		SAMPLE_DECKS.map((deck) =>
			shuffle(
				LANDING_CARDS.filter((plate) => plate.deck === deck.title),
				random,
			),
		),
		random,
	);
	const pool: LandingPlate[] = [];
	for (let round = 0; pool.length < LANDING_CARDS.length; round += 1) {
		for (const deck of decks) {
			const plate = deck[round];
			if (plate) pool.push(plate);
		}
	}
	return pool;
}
