import { CARD_THEME_DEFINITIONS, type ThemeId } from "@slidesage/cards";
import type { CSSProperties } from "react";

/** Class names kept compatible with existing CardView consumers. */
export interface CardTheme {
	surface: string;
	heading: string;
	body: string;
	muted: string;
	accent: string;
	rule: string;
	style?: CSSProperties;
}

export const CARD_THEMES = Object.fromEntries(
	Object.values(CARD_THEME_DEFINITIONS).map((theme) => [
		theme.id,
		{
			surface: "bg-[var(--card-surface)] shadow-[0_24px_60px_rgba(0,0,0,0.25)]",
			heading: "text-[color:var(--card-heading)] font-[family-name:var(--card-heading-font)]",
			body: "text-[color:var(--card-body)]",
			muted: "text-[color:var(--card-muted)]",
			accent: "text-[color:var(--card-accent)]",
			rule: "border-[color:var(--card-rule)]",
			style: {
				...Object.fromEntries(
					Object.entries(theme.palette).map(([key, color]) => [`--card-${key}`, color]),
				),
				"--card-heading-font": theme.fonts.heading.cssFamily,
				fontFamily: theme.fonts.body.cssFamily,
			} as CSSProperties,
		},
	]),
) as Record<ThemeId, CardTheme>;
