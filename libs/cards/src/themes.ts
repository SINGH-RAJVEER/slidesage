import type { ThemeId } from "./schema";

/** Solid sRGB colors, shared by browser rendering and native PPTX shapes. */
export interface ThemePalette {
	surface: string;
	heading: string;
	body: string;
	muted: string;
	accent: string;
	rule: string;
}

export interface ThemeFont {
	/** Native font name written to PPTX. Fonts are referenced, never embedded. */
	face: string;
	/** Browser stack, including fallbacks when the parent has not loaded the font. */
	cssFamily: string;
	/** Google Fonts family to load in the parent app, absent for system fonts. */
	googleFamily?: string;
	weights: readonly number[];
}

export interface CardThemeDefinition {
	id: ThemeId;
	name: string;
	description: string;
	appearance: "light" | "dark";
	curated: boolean;
	palette: ThemePalette;
	fonts: { heading: ThemeFont; body: ThemeFont };
}

const arial: ThemeFont = {
	face: "Arial",
	cssFamily: "Arial, Helvetica, sans-serif",
	weights: [400, 600, 700],
};
const georgia: ThemeFont = {
	face: "Georgia",
	cssFamily: "Georgia, 'Times New Roman', serif",
	weights: [400, 600, 700],
};

/** Load regular/italic body styles and the listed weights before measuring cards. */
export const THEME_FONTS = {
	dmSans: {
		face: "DM Sans",
		cssFamily: "'DM Sans', Arial, sans-serif",
		googleFamily: "DM Sans",
		weights: [400, 500, 600, 700],
	},
	fraunces: {
		face: "Fraunces",
		cssFamily: "Fraunces, Georgia, serif",
		googleFamily: "Fraunces",
		weights: [400, 500, 600, 700],
	},
	spaceGrotesk: {
		face: "Space Grotesk",
		cssFamily: "'Space Grotesk', 'Trebuchet MS', Arial, sans-serif",
		googleFamily: "Space Grotesk",
		weights: [400, 500, 600, 700],
	},
	plexMono: {
		face: "IBM Plex Mono",
		cssFamily: "'IBM Plex Mono', 'Courier New', monospace",
		googleFamily: "IBM Plex Mono",
		weights: [400, 500, 600, 700],
	},
} satisfies Record<string, ThemeFont>;

/** Flatten the old translucent tokens once, so exports and previews agree. */
function over(color: string, alpha: number, surface: string): string {
	const channel = (hex: string, offset: number) =>
		Number.parseInt(hex.slice(offset, offset + 2), 16);
	return `#${[1, 3, 5]
		.map((offset) =>
			Math.round(channel(color, offset) * alpha + channel(surface, offset) * (1 - alpha))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

function palette(
	surface: string,
	heading: string,
	body: string,
	muted: string,
	accent: string,
	rule: string,
): ThemePalette {
	return { surface, heading, body, muted, accent, rule };
}

export const CARD_THEME_DEFINITIONS: Record<ThemeId, CardThemeDefinition> = {
	slate: {
		id: "slate",
		name: "Slate",
		description: "The original dark blue theme.",
		appearance: "dark",
		curated: false,
		palette: palette(
			"#1b2130",
			"#ffffff",
			over("#ffffff", 0.8, "#1b2130"),
			over("#ffffff", 0.45, "#1b2130"),
			"#7dd3fc",
			over("#ffffff", 0.1, "#1b2130"),
		),
		fonts: { heading: arial, body: arial },
	},
	paper: {
		id: "paper",
		name: "Paper",
		description: "The original warm paper theme.",
		appearance: "light",
		curated: false,
		palette: palette(
			"#f7f5f0",
			"#1d1f24",
			"#3a3d44",
			"#7a7d85",
			"#b4532a",
			over("#000000", 0.1, "#f7f5f0"),
		),
		fonts: { heading: arial, body: arial },
	},
	ember: {
		id: "ember",
		name: "Ember",
		description: "The original copper on charcoal theme.",
		appearance: "dark",
		curated: false,
		palette: palette(
			"#231a17",
			"#fbeee4",
			over("#f1d9c9", 0.85, "#231a17"),
			over("#f1d9c9", 0.45, "#231a17"),
			"#ff9b6a",
			over("#f1d9c9", 0.12, "#231a17"),
		),
		fonts: { heading: arial, body: arial },
	},
	ocean: {
		id: "ocean",
		name: "Ocean",
		description: "Ink blue and sea glass for business proposals.",
		appearance: "dark",
		curated: true,
		palette: palette("#102f3b", "#effafb", "#c5dce1", "#91b3bd", "#70dfc3", "#365864"),
		fonts: { heading: THEME_FONTS.spaceGrotesk, body: THEME_FONTS.dmSans },
	},
	grove: {
		id: "grove",
		name: "Grove",
		description: "Pale sage with botanical serif headings.",
		appearance: "light",
		curated: true,
		palette: palette("#edf3e8", "#23392d", "#3b5143", "#627565", "#466e38", "#c6d4be"),
		fonts: { heading: THEME_FONTS.fraunces, body: THEME_FONTS.dmSans },
	},
	orchid: {
		id: "orchid",
		name: "Orchid",
		description: "Lavender and plum for creative portfolios.",
		appearance: "light",
		curated: true,
		palette: palette("#f0eafa", "#38234f", "#554167", "#77628a", "#843caf", "#d6c7e7"),
		fonts: { heading: THEME_FONTS.spaceGrotesk, body: THEME_FONTS.dmSans },
	},
	sand: {
		id: "sand",
		name: "Sand",
		description: "Stone, ochre and classic editorial type.",
		appearance: "light",
		curated: true,
		palette: palette("#f4ead8", "#42382b", "#5c5141", "#7b6e5b", "#926016", "#d8c8ad"),
		fonts: { heading: georgia, body: THEME_FONTS.dmSans },
	},
	cobalt: {
		id: "cobalt",
		name: "Cobalt",
		description: "Electric blue and lemon for product launches.",
		appearance: "dark",
		curated: true,
		palette: palette("#1739b5", "#ffffff", "#e1e8ff", "#b5c5ff", "#f4f38a", "#5874d0"),
		fonts: { heading: THEME_FONTS.spaceGrotesk, body: THEME_FONTS.dmSans },
	},
	mono: {
		id: "mono",
		name: "Mono",
		description: "Graphite and cool gray with technical monospace headings.",
		appearance: "light",
		curated: true,
		palette: palette("#eef0f2", "#202a35", "#3e4b59", "#677482", "#245e8a", "#c8cfd7"),
		fonts: { heading: THEME_FONTS.plexMono, body: arial },
	},
};

export const CURATED_THEMES = Object.values(CARD_THEME_DEFINITIONS).filter(
	(theme) => theme.curated,
);

/** Neutral text over photos. Both renderers retain the deck's font pair. */
export const COVER_PALETTE: ThemePalette = palette(
	"#000000",
	"#ffffff",
	"#f2f2f2",
	"#d0d0d0",
	"#ffffff",
	"#ffffff",
);
