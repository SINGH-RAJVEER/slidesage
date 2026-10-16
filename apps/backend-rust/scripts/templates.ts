import { CARD_TEMPLATES } from "../../../libs/cards/src/templates";

// The Rust worker embeds these curated documents and never invokes Bun.
// handler.test.ts compares every response with CARD_TEMPLATES to detect drift.
const catalog = Object.fromEntries(
	CARD_TEMPLATES.map(({ id, document, assets }) => [id, { document, assets }]),
);
await Bun.write(
	new URL("../src/cards/templates.json", import.meta.url),
	`${JSON.stringify(catalog, null, "\t")}\n`,
);
