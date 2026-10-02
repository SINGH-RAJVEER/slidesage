import type { ThemeId } from "@slidesage/cards";

export interface CardTheme {
	/** The card surface. */
	surface: string;
	heading: string;
	body: string;
	muted: string;
	accent: string;
	/** Hairlines between columns and steps; never boxes around content. */
	rule: string;
}

/**
 * Named themes. A document picks one by ID, so no styling ever comes from
 * document content.
 */
export const CARD_THEMES: Record<ThemeId, CardTheme> = {
	slate: {
		surface: "bg-[#1b2130] shadow-[0_24px_60px_rgba(0,0,0,0.35)]",
		heading: "text-white",
		body: "text-white/80",
		muted: "text-white/45",
		accent: "text-sky-300",
		rule: "border-white/10",
	},
	paper: {
		surface: "bg-[#f7f5f0] shadow-[0_24px_60px_rgba(0,0,0,0.25)]",
		heading: "text-[#1d1f24]",
		body: "text-[#3a3d44]",
		muted: "text-[#7a7d85]",
		accent: "text-[#b4532a]",
		rule: "border-black/10",
	},
	ember: {
		surface: "bg-[#231a17] shadow-[0_24px_60px_rgba(0,0,0,0.35)]",
		heading: "text-[#fbeee4]",
		body: "text-[#f1d9c9]/85",
		muted: "text-[#f1d9c9]/45",
		accent: "text-[#ff9b6a]",
		rule: "border-[#f1d9c9]/12",
	},
};
