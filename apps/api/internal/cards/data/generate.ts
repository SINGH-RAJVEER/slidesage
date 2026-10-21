// Writes the card data the Go converter embeds, taken from libs/cards so both
// implementations serve the same catalog, schema, and theme colors.
// Run with `bun apps/api/internal/cards/data/generate.ts [directory]`; the Go
// tests run it into a temporary directory and fail when the files drift.
import {
	CARD_TEMPLATES,
	CARD_THEME_DEFINITIONS,
	COVER_PALETTE,
	draftingSchema,
	STOCK_LIBRARIES,
} from "../../../../../libs/cards/src";

const directory = process.argv[2] ?? import.meta.dir;

async function write(name: string, value: unknown) {
	await Bun.write(`${directory}/${name}`, `${JSON.stringify(value, null, "\t")}\n`);
}

await write(
	"templates.json",
	Object.fromEntries(
		CARD_TEMPLATES.map(({ id, document, assets }) => [id, { document, assets }]),
	),
);
await write("drafting-schema.json", draftingSchema());
await write("themes.json", {
	themes: Object.fromEntries(
		Object.entries(CARD_THEME_DEFINITIONS).map(([id, theme]) => [
			id,
			{
				palette: theme.palette,
				chart: theme.chart,
				fonts: { heading: theme.fonts.heading.face, body: theme.fonts.body.face },
			},
		]),
	),
	cover: COVER_PALETTE,
	stockLibraries: STOCK_LIBRARIES,
});
