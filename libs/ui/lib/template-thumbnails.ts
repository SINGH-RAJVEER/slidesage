import { API_URL } from "./api";

/**
 * URL of a template's cover thumbnail.
 *
 * Thumbnails live beside their package under the signed CDN prefix, so the
 * browser cannot address them directly: an unsigned request is refused. The API
 * signs and serves them, which also keeps the marketplace from downloading a
 * whole package just to show a cover.
 */
export function templateThumbnailUrl(thumbnailPath: string): string {
	return `${API_URL}/template-thumbnails/${encodeURIComponent(thumbnailPath)}`;
}

/**
 * Published sizes of a slide preview.
 *
 * "small" is a reduced-width copy published beside the full render, for callers
 * that paint a slide at thumbnail size: a full render is 1600 pixels wide and
 * costs several megabytes of decoded bitmap, which is pure waste on a landing
 * plate a few hundred pixels across. A template published before the small
 * variant existed serves its full slide instead, so asking for one is always
 * safe.
 */
export type TemplateSlideVariant = "full" | "small";

/**
 * URL of one rendered slide from a published template package.
 *
 * These are the same full-slide previews the marketplace viewer reads. The
 * digest is part of the path, so a caller that already holds the published
 * digest - every reader of the catalog does - addresses a slide without
 * fetching the preview manifest first.
 */
export function templateSlidePreviewUrl(
	id: string,
	version: number,
	sha256: string,
	index: number,
	variant: TemplateSlideVariant = "full",
): string {
	const slide = `${API_URL}/template-previews/${encodeURIComponent(id)}/${version}/${sha256}/${index}`;
	return variant === "small" ? `${slide}/small` : slide;
}
