import type { PresentationTemplateReference } from "@slidesage/types";
import { MARKETPLACE_ITEMS } from "./catalog";

const STORAGE_KEY = "slidesage-installed-marketplace-themes";
export const MARKETPLACE_THEMES_UPDATED_EVENT = "slidesage:marketplace-themes-updated";

export interface InstalledMarketplaceTheme {
	marketplaceId: string;
	name: string;
	description: string;
	templateReference: PresentationTemplateReference;
	thumbnailPath: string;
}

/**
 * What a first visit starts with: one template from every category, so the
 * selector is useful before the reader has opened the marketplace.
 *
 * This is a seed, not a floor. Removing all of them leaves the selector empty
 * and generation blocked until one is installed, which is the honest state to
 * be in; nothing is silently reinstated.
 */
function preinstalledReferences(): PresentationTemplateReference[] {
	return MARKETPLACE_ITEMS.filter((item) => item.preinstalled && item.available).map(
		(item) => item.templateReference,
	);
}

function getStoredReferences(): PresentationTemplateReference[] {
	if (typeof window === "undefined") return [];

	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		// Absent and empty are different answers: absent is a reader who has
		// never installed anything, empty is one who removed everything.
		if (raw === null) {
			const seeded = preinstalledReferences();
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
			return seeded;
		}
		const stored = JSON.parse(raw);
		if (!Array.isArray(stored)) return [];

		const references = stored.flatMap((value): PresentationTemplateReference[] => {
			const id = typeof value === "string" ? value : value?.id;
			const item = MARKETPLACE_ITEMS.find((candidate) => candidate.id === id);
			if (!item) return [];
			if (typeof value !== "string" && value.version !== item.templateReference.version) return [];
			return [item.templateReference];
		});
		const uniqueReferences = references.filter(
			(reference, index) =>
				references.findIndex((candidate) => candidate.id === reference.id) === index,
		);
		const serialized = JSON.stringify(uniqueReferences);
		if (window.localStorage.getItem(STORAGE_KEY) !== serialized) {
			window.localStorage.setItem(STORAGE_KEY, serialized);
		}
		return uniqueReferences;
	} catch {
		return [];
	}
}

export function getInstalledMarketplaceThemes(): InstalledMarketplaceTheme[] {
	const installedIds = new Set(getStoredReferences().map((reference) => reference.id));
	return MARKETPLACE_ITEMS.filter((item) => installedIds.has(item.id)).map((item) => ({
		marketplaceId: item.id,
		name: item.name,
		description: item.description,
		templateReference: item.templateReference,
		thumbnailPath: item.thumbnailPath,
	}));
}

export function installMarketplaceTheme(marketplaceId: string) {
	const item = MARKETPLACE_ITEMS.find((candidate) => candidate.id === marketplaceId);
	// An unpublished template has no package to compile, so installing it would
	// only add a permanently disabled entry to the selector.
	if (!item?.available || typeof window === "undefined") return false;

	const installedReferences = getStoredReferences();
	if (!installedReferences.some((reference) => reference.id === marketplaceId)) {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([...installedReferences, item.templateReference]),
		);
		window.dispatchEvent(new Event(MARKETPLACE_THEMES_UPDATED_EVENT));
	}
	return true;
}

export function removeMarketplaceTheme(marketplaceId: string) {
	if (typeof window === "undefined") return false;

	const installedReferences = getStoredReferences();
	if (!installedReferences.some((reference) => reference.id === marketplaceId)) return false;

	window.localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify(installedReferences.filter((reference) => reference.id !== marketplaceId)),
	);
	window.dispatchEvent(new Event(MARKETPLACE_THEMES_UPDATED_EVENT));
	return true;
}

export function isMarketplaceThemeInstalled(marketplaceId: string) {
	return getStoredReferences().some((reference) => reference.id === marketplaceId);
}
