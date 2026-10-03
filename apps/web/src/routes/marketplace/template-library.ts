import { getCardTemplate } from "@slidesage/cards";
import { useSyncExternalStore } from "react";

export const TEMPLATE_LIBRARY_KEY = "slidesage.template-library.v1";
const UPDATED = "slidesage:template-library-updated";

function snapshot(): string {
	try {
		return localStorage.getItem(TEMPLATE_LIBRARY_KEY) ?? "[]";
	} catch {
		return "[]";
	}
}

export function readTemplateLibrary(raw: string): string[] {
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
	const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
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
