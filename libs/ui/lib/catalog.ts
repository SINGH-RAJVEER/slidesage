import {
	BINARY_PPTX_TEMPLATE_CATALOG,
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
		sha256: entry.asset.sha256,
		slideCount: entry.slideCount,
		available: entry.asset.status === "available",
	};
}

export const MARKETPLACE_ITEMS: MarketplaceItem[] = BINARY_PPTX_TEMPLATE_CATALOG.filter(
	(entry) => entry.availability === "marketplace",
).map(marketplaceItem);
