import { CARD_TEMPLATES, getCardTemplate, TEMPLATE_CATEGORIES } from "@slidesage/cards";
import { useSyncExternalStore } from "react";

export const TEMPLATE_LIBRARY_KEY = "slidesage.template-library.v1";
const UPDATED = "slidesage:template-library-updated";

/**
 * The first template of every category. A reader who has never installed
 * anything starts with these, so there is something to generate with.
 *
 * This is a seed, not a floor. An absent key is a reader who never installed
 * anything; an empty list is one who removed everything, and stays empty.
 */
export const PREINSTALLED_TEMPLATE_IDS = TEMPLATE_CATEGORIES.flatMap((category) => {
	const template = CARD_TEMPLATES.find((candidate) => candidate.category === category.id);
	return template ? [template.id] : [];
});

function snapshot(): string | null {
	try {
		return localStorage.getItem(TEMPLATE_LIBRARY_KEY);
	} catch {
		return null;
	}
}

export function readTemplateLibrary(raw: string | null): string[] {
	if (raw === null) return PREINSTALLED_TEMPLATE_IDS;
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value)
			? [
					...new Set(
						value.filter((id): id is string => typeof id === "string" && !!getCardTemplate(id)),
					),
				]
			: [];
	} catch {
		return [];
	}
}

function subscribe(notify: () => void) {
	window.addEventListener("storage", notify);
	window.addEventListener(UPDATED, notify);
	return () => {
		window.removeEventListener("storage", notify);
		window.removeEventListener(UPDATED, notify);
	};
}

export function useTemplateLibrary() {
	const raw = useSyncExternalStore(subscribe, snapshot, () => null);
	return {
		ids: readTemplateLibrary(raw),
		setInstalled(id: string, installed: boolean) {
			if (!getCardTemplate(id)) return;
			const ids = readTemplateLibrary(snapshot()).filter((saved) => saved !== id);
			if (installed) ids.push(id);
			// Persist before notifying. A storage failure must not claim an install succeeded.
			localStorage.setItem(TEMPLATE_LIBRARY_KEY, JSON.stringify(ids));
			window.dispatchEvent(new Event(UPDATED));
		},
	};
}
