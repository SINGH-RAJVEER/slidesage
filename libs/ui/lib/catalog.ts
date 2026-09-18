import {
	BINARY_PPTX_TEMPLATE_CATALOG,
	BINARY_TEMPLATE_CATEGORIES,
	type BinaryPptxTemplate,
	type PresentationTemplateReference,
} from "@slidesage/types";

export interface MarketplaceItem {
	id: string;
	name: string;
	description: string;
	tags: string[];
	templateReference: PresentationTemplateReference;
	sourceFilename: string;
	aspectRatio: BinaryPptxTemplate["dimensions"]["aspectRatio"];
	dimensions: BinaryPptxTemplate["dimensions"];
	/** Object path of the cover thumbnail rendered from the package itself. */
	thumbnailPath: string;
	/** Whether a first visit starts with this template installed. */
	preinstalled: boolean;
	/** Digest of the published package, absent until the template is published. */
	sha256?: string;
	/** Slides in the published package, zero when nothing is published yet. */
	slideCount: number;
	available: boolean;
}

/**
 * Slides of a template that are worth showing on their own.
 *
 * Every package in the catalog closes with the same credits slide - the
 * "free for everyone to use, thanks to the following" attribution page - which
 * is the one slide that says nothing about the design. Dropping the last slide
 * drops exactly that page; `templatemanifest`'s embedded manifests are the
 * authority, and its test holds the closing archetype to the final slide so
 * this arithmetic cannot quietly start cutting a content page instead.
 */
export function presentableSlideCount(item: MarketplaceItem): number {
	return Math.max(0, item.slideCount - 1);
}

function marketplaceTags(entry: BinaryPptxTemplate): string[] {
	return [
		...entry.name.toLowerCase().split(/[^a-z0-9]+/),
		// The category is searchable so "education" finds the lesson decks even
		// though none of them carry the word in their name.
		...(BINARY_TEMPLATE_CATEGORIES.find((category) => category.id === entry.category)?.label ?? "")
			.toLowerCase()
			.split(/[^a-z0-9]+/),
		"pptx",
		"powerpoint",
		entry.dimensions.aspectRatio.label.toLowerCase(),
	].filter((tag, index, tags) => tag.length > 1 && tags.indexOf(tag) === index);
}

export function marketplaceItem(entry: BinaryPptxTemplate): MarketplaceItem {
	return {
		id: entry.id,
		name: entry.name,
		description: `${entry.name} is a PowerPoint template in ${entry.dimensions.aspectRatio.label} format.`,
		tags: marketplaceTags(entry),
		templateReference: { id: entry.id, version: entry.version },
		sourceFilename: entry.sourceFilename,
		aspectRatio: entry.dimensions.aspectRatio,
		dimensions: entry.dimensions,
		thumbnailPath: entry.thumbnailPath,
		preinstalled: entry.preinstalled,
		sha256: entry.asset.sha256,
		slideCount: entry.slideCount,
		available: entry.asset.status === "available",
	};
}

// Every published template is a marketplace template. A preinstalled one is
// installed for a reader who has never opened the marketplace, not hidden from
// it, so it is listed and can be removed like any other.
export const MARKETPLACE_ITEMS: MarketplaceItem[] =
	BINARY_PPTX_TEMPLATE_CATALOG.map(marketplaceItem);
