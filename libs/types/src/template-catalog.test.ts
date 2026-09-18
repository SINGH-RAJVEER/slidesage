import { describe, expect, it } from "bun:test";
import { BINARY_PPTX_TEMPLATE_CATALOG, BINARY_TEMPLATE_CATEGORIES } from "./template-catalog";

describe("binary PPTX template catalog", () => {
	it("contains 30 templates, seven of them preinstalled", () => {
		expect(BINARY_PPTX_TEMPLATE_CATALOG).toHaveLength(30);
		expect(BINARY_PPTX_TEMPLATE_CATALOG.filter((entry) => entry.preinstalled)).toHaveLength(7);
	});

	// A reader who has never opened the marketplace still has somewhere to start
	// whatever they are writing, so the seeded set spans every category.
	it("preinstalls a template from every category", () => {
		const preinstalled = BINARY_PPTX_TEMPLATE_CATALOG.filter((entry) => entry.preinstalled);

		expect(new Set(preinstalled.map((entry) => entry.category))).toEqual(
			new Set(BINARY_TEMPLATE_CATEGORIES.map((category) => category.id)),
		);
		expect(preinstalled.map((entry) => entry.id)).toEqual([
			"5s-training",
			"modern-minimal-grid-financial-management",
			"minimalist-marketing-annual-report",
			"simple-business-proposal",
			"simple-performance-review",
			"soft-skills-training",
			"my-travel-wrapped",
		]);
	});

	it("gives every template a category", () => {
		const categories = new Set(BINARY_TEMPLATE_CATEGORIES.map((category) => category.id));

		expect(BINARY_PPTX_TEMPLATE_CATALOG.every((entry) => categories.has(entry.category))).toBe(
			true,
		);
	});

	it("uses stable IDs as unique source filenames", () => {
		const ids = BINARY_PPTX_TEMPLATE_CATALOG.map((entry) => entry.id);
		const sourceFilenames = BINARY_PPTX_TEMPLATE_CATALOG.map((entry) => entry.sourceFilename);

		expect(new Set(ids).size).toBe(BINARY_PPTX_TEMPLATE_CATALOG.length);
		expect(new Set(sourceFilenames).size).toBe(BINARY_PPTX_TEMPLATE_CATALOG.length);
		expect(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true);
		expect(sourceFilenames).toEqual(
			BINARY_PPTX_TEMPLATE_CATALOG.map((entry) => `${entry.id}.pptx`),
		);
	});

	it("derives asset status and digest from the published digest map", () => {
		for (const entry of BINARY_PPTX_TEMPLATE_CATALOG) {
			expect(entry.version).toBe(1);
			expect(entry.thumbnailPath).toBe(`pptx-templates/${entry.id}/1/thumbnails/cover.webp`);

			if (entry.asset.status === "available") {
				expect(entry.asset.sha256).toMatch(/^[0-9a-f]{64}$/);
			} else {
				expect(entry.asset).not.toHaveProperty("sha256");
			}
		}
	});

	it("has a published package for every release template", () => {
		expect(
			BINARY_PPTX_TEMPLATE_CATALOG.filter((entry) => entry.asset.status !== "available").map(
				(entry) => entry.id,
			),
		).toEqual([]);
	});
});
