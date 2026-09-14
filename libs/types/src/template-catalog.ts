import templateDigests from "./template-digests.json";

/**
 * What a template is for, which is how a reader picks one.
 *
 * A category describes subject matter rather than styling: someone opening the
 * selector is looking for the deck they are about to write, not a colour.
 */
export type BinaryTemplateCategory = "business" | "marketing" | "education" | "creative";

/** Category order and labels for the selector and the marketplace. */
export const BINARY_TEMPLATE_CATEGORIES: readonly {
	id: BinaryTemplateCategory;
	label: string;
}[] = [
	{ id: "business", label: "Business & Finance" },
	{ id: "marketing", label: "Marketing & Social" },
	{ id: "education", label: "Education & Training" },
	{ id: "creative", label: "Creative & Lifestyle" },
];

export type BinaryTemplateAssetStatus = "pending-upload" | "available";

export interface BinaryTemplateAspectRatio {
	width: number;
	height: number;
	label: "16:9" | "A-series portrait";
}

export interface BinaryTemplateDimensions {
	widthEmu: number;
	heightEmu: number;
	aspectRatio: BinaryTemplateAspectRatio;
}

export interface PresentationTemplateReference {
	id: string;
	version: number;
	/**
	 * Digest of the published package the presentation was compiled from. The
	 * server resolves it from the published catalog and writes it onto the
	 * stored document, so it is absent on a reference the client is sending and
	 * present on one it reads back.
	 */
	sha256?: string;
}

export interface BinaryPptxTemplate {
	id: string;
	name: string;
	version: 1;
	/**
	 * Whether a first visit starts with this template installed. The set covers
	 * every category, so a reader who has not opened the marketplace still has
	 * somewhere to start whatever they are writing. Preinstalled is a starting
	 * point, not a privilege: these are removable and listed in the marketplace
	 * like every other template.
	 */
	preinstalled: boolean;
	category: BinaryTemplateCategory;
	sourceFilename: string;
	dimensions: BinaryTemplateDimensions;
	/**
	 * Browser-facing publication hint only. The authority for whether a package
	 * exists at a digest-pinned key is the API's published catalog
	 * (apps/api/internal/templatecatalog/published.json); generation resolves
	 * the digest there and rejects anything it does not list, whatever this
	 * says.
	 */
	asset: {
		status: BinaryTemplateAssetStatus;
		sha256?: string;
	};
	/** Object path of the rendered cover thumbnail, relative to the CDN root. */
	thumbnailPath: string;
	/**
	 * Slides in the published package, zero when nothing is published yet. It
	 * is what lets a reader address a slide preview without asking the API for
	 * a manifest first.
	 */
	slideCount: number;
}

const WIDESCREEN: BinaryTemplateDimensions = {
	widthEmu: 18_288_000,
	heightEmu: 10_287_000,
	aspectRatio: { width: 16, height: 9, label: "16:9" },
};

const HALF_SCALE_WIDESCREEN: BinaryTemplateDimensions = {
	widthEmu: 9_144_000,
	heightEmu: 5_143_500,
	aspectRatio: { width: 16, height: 9, label: "16:9" },
};

type CatalogEntry = Omit<
	BinaryPptxTemplate,
	"asset" | "sourceFilename" | "version" | "thumbnailPath" | "slideCount"
>;

/**
 * Digests are backfilled by `go run ./cmd/publish-templates`, which sanitizes
 * each package, hashes the sanitized bytes, and uploads them to a digest-pinned
 * key. A template is available exactly when a published digest exists for it.
 */
const publishedDigests: Record<string, { sha256: string; slideCount: number } | undefined> =
	templateDigests;

function template(entry: CatalogEntry): BinaryPptxTemplate {
	const published = publishedDigests[entry.id];
	return {
		...entry,
		version: 1,
		sourceFilename: `${entry.id}.pptx`,
		asset: published
			? { status: "available", sha256: published.sha256 }
			: { status: "pending-upload" },
		thumbnailPath: `pptx-templates/${entry.id}/1/thumbnails/cover.webp`,
		slideCount: published?.slideCount ?? 0,
	};
}

export const BINARY_PPTX_TEMPLATE_CATALOG = [
	template({
		id: "5s-training",
		name: "5S Training",
		preinstalled: true,
		category: "education",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "modern-minimal-grid-financial-management",
		name: "Financial Management",
		preinstalled: true,
		category: "business",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "minimalist-marketing-annual-report",
		name: "Marketing Annual Report",
		preinstalled: true,
		category: "marketing",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "festive-pattern-travel-agency-business-plan",
		name: "Travel Agency Business Plan",
		preinstalled: false,
		category: "business",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "renaissance-odyssey-language-arts",
		name: "The Odyssey Language Arts",
		preinstalled: false,
		category: "education",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "textured-scrapbook-go-green",
		name: "Go Green Social Strategy",
		preinstalled: false,
		category: "marketing",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "geometric-mathematics-lesson",
		name: "Mathematics Lesson",
		preinstalled: false,
		category: "education",
		dimensions: HALF_SCALE_WIDESCREEN,
	}),
	template({
		id: "charli-xcx-brat-album-inspired",
		name: "Neon Halftone Pop",
		preinstalled: false,
		category: "creative",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "saving-and-investment",
		name: "Saving and Investment",
		preinstalled: false,
		category: "education",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "email-marketing-workflow",
		name: "Email Marketing Workflow",
		preinstalled: false,
		category: "marketing",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "middle-school-functions-lesson",
		name: "Functions Lesson",
		preinstalled: false,
		category: "education",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "grade-1-addition",
		name: "Grade 1 Addition",
		preinstalled: false,
		category: "education",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "minimal-elegant-branding-kit",
		name: "Elegant Branding Kit",
		preinstalled: false,
		category: "marketing",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "fun-doodles-welcome-to-math-class",
		name: "Math Class Doodles",
		preinstalled: false,
		category: "education",
		dimensions: HALF_SCALE_WIDESCREEN,
	}),
	template({
		id: "mid-autumn-moon-festival",
		name: "Mid-Autumn Moon Festival",
		preinstalled: false,
		category: "creative",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "geometric-aesthetic-social-media-planner",
		name: "Social Media Planner",
		preinstalled: false,
		category: "marketing",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "illustrative-tv-series-social-media",
		name: "TV Series Social Media",
		preinstalled: false,
		category: "marketing",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "new-jeans-y2k-style",
		name: "Y2K Pop",
		preinstalled: false,
		category: "creative",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "illustrative-mathematics-quiz",
		name: "Mathematics Quiz",
		preinstalled: false,
		category: "education",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "pastel-street-maps-minitheme",
		name: "Street Maps",
		preinstalled: false,
		category: "creative",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "pink-doodles-math-online-class",
		name: "Math Online Class",
		preinstalled: false,
		category: "education",
		dimensions: HALF_SCALE_WIDESCREEN,
	}),
	template({
		id: "hotel-sales-strategy",
		name: "Hotel Sales Strategy",
		preinstalled: false,
		category: "business",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "simple-business-proposal",
		name: "Simple Business Proposal",
		preinstalled: true,
		category: "business",
		dimensions: HALF_SCALE_WIDESCREEN,
	}),
	template({
		id: "illustrative-design-inspiration",
		name: "Social Media Design Inspiration",
		preinstalled: false,
		category: "marketing",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "simple-performance-review",
		name: "Simple Performance Review",
		preinstalled: true,
		category: "business",
		dimensions: HALF_SCALE_WIDESCREEN,
	}),
	template({
		id: "soft-skills-training",
		name: "Soft Skills Training",
		preinstalled: true,
		category: "education",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "stock-management-system-project-proposal",
		name: "Project Proposal",
		preinstalled: false,
		category: "business",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "stocks-trading-business-plan",
		name: "Stocks Trading Business Plan",
		preinstalled: false,
		category: "business",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "strategic-media-planning",
		name: "Strategic Media Planning",
		preinstalled: false,
		category: "marketing",
		dimensions: WIDESCREEN,
	}),
	template({
		id: "my-travel-wrapped",
		name: "My Year in Travel",
		preinstalled: true,
		category: "creative",
		dimensions: WIDESCREEN,
	}),
] as const satisfies readonly BinaryPptxTemplate[];
