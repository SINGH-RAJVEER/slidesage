// Writes the parts of a PPTX file that pptxgenjs writes the same for every
// deck the converter exports, so the Go writer embeds them byte for byte.
// Run with `bun apps/api/internal/cards/pptx/templates/generate.ts [directory]`;
// the Go tests run it into a temporary directory and fail when the files drift.
import JSZip from "../../../../../converter/node_modules/jszip";
import PptxGenJS from "../../../../../converter/node_modules/pptxgenjs";

const directory = process.argv[2] ?? import.meta.dir;

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
// Placeholders the Go writer replaces with the deck's fonts.
pptx.theme = { headFontFace: "{{heading}}", bodyFontFace: "{{body}}" };
pptx.addSlide().addChart("bar", [{ name: "a", labels: ["b"], values: [1] }], {});
const presentation = await JSZip.loadAsync(await pptx.write({ outputType: "uint8array" }));

const embedded = presentation.file(/^ppt\/embeddings\/.*\.xlsx$/)[0];
if (!embedded) throw new Error("pptxgenjs wrote no chart workbook");
const workbook = await JSZip.loadAsync(await embedded.async("uint8array"));

const parts: [JSZip, string, string][] = [
	[presentation, "_rels/.rels", "root.rels"],
	[presentation, "ppt/presProps.xml", "presProps.xml"],
	[presentation, "ppt/tableStyles.xml", "tableStyles.xml"],
	[presentation, "ppt/viewProps.xml", "viewProps.xml"],
	[presentation, "ppt/theme/theme1.xml", "theme.xml"],
	[presentation, "ppt/slideLayouts/slideLayout1.xml", "slideLayout.xml"],
	[presentation, "ppt/slideLayouts/_rels/slideLayout1.xml.rels", "slideLayout.rels"],
	[presentation, "ppt/slideMasters/slideMaster1.xml", "slideMaster.xml"],
	[presentation, "ppt/slideMasters/_rels/slideMaster1.xml.rels", "slideMaster.rels"],
	[presentation, "ppt/notesMasters/notesMaster1.xml", "notesMaster.xml"],
	[presentation, "ppt/notesMasters/_rels/notesMaster1.xml.rels", "notesMaster.rels"],
	[workbook, "[Content_Types].xml", "sheet-content-types.xml"],
	[workbook, "_rels/.rels", "sheet-root.rels"],
	[workbook, "docProps/app.xml", "sheet-app.xml"],
	[workbook, "xl/_rels/workbook.xml.rels", "sheet-workbook.rels"],
	[workbook, "xl/styles.xml", "sheet-styles.xml"],
	[workbook, "xl/theme/theme1.xml", "sheet-theme.xml"],
	[workbook, "xl/workbook.xml", "sheet-workbook.xml"],
	[workbook, "xl/worksheets/_rels/sheet1.xml.rels", "sheet-sheet.rels"],
];
for (const [zip, path, name] of parts) {
	const file = zip.file(path);
	if (!file) throw new Error(`pptxgenjs wrote no ${path}`);
	await Bun.write(`${directory}/${name}`, await file.async("uint8array"));
}

// Parts that vary with the deck are written from pptxgenjs's own template
// literals, with their ${...} expressions kept for the Go writer to fill.
const source = await Bun.file(
	new URL("../../../../../converter/node_modules/pptxgenjs/dist/pptxgen.es.js", import.meta.url),
).text();
for (const [name, file] of [
	["makeXmlApp", "app.xml.tmpl"],
	["makeXmlCore", "core.xml.tmpl"],
	["makeXmlNotesSlide", "notesSlide.xml.tmpl"],
	["makeXmlNotesSlideRel", "notesSlide.rels.tmpl"],
] as const) {
	const start = source.indexOf(`function ${name}(`);
	const open = source.indexOf("`", start);
	if (start < 0 || open < 0) throw new Error(`pptxgenjs has no ${name} template`);
	const close = templateEnd(source, open + 1);
	await Bun.write(`${directory}/${file}`, source.slice(open + 1, close));
}

/** The index of the backtick closing a template literal whose body starts at `at`. */
function templateEnd(text: string, at: number): number {
	for (let index = at; index < text.length; index++) {
		if (text[index] === "\\") index++;
		else if (text[index] === "`") return index;
		else if (text.startsWith("${", index)) index = expressionEnd(text, index + 2);
	}
	throw new Error("unterminated template literal");
}

/** The index of the brace closing a template expression whose body starts at `at`. */
function expressionEnd(text: string, at: number): number {
	let depth = 0;
	for (let index = at; index < text.length; index++) {
		const char = text[index];
		if (char === "`") index = templateEnd(text, index + 1);
		else if (char === "{") depth++;
		else if (char === "}" && depth-- === 0) return index;
	}
	throw new Error("unterminated template expression");
}

// The cover scrim is the second picture on a cover slide: the PNG the
// TypeScript export compresses with Bun's zlib.
const { writePptx } = await import("../../../../../converter/src/pptx");
const asset = "c".repeat(64);
const cover = await JSZip.loadAsync(
	await writePptx({
		document: {
			schemaVersion: 3,
			title: "Scrim",
			theme: "paper",
			cardOrder: ["c_scrimcard"],
			cards: {
				c_scrimcard: {
					id: "c_scrimcard",
					takeaway: "Scrim",
					role: "opening",
					layout: "cover",
					nodes: [
						{ id: "n_scrimimage", type: "image", assetId: asset, alt: "Photo", fit: "cover" },
						{ id: "n_scrimheading", type: "heading", text: [{ text: "Scrim" }] },
					],
					sourceIds: [],
				},
			},
		},
		assets: { [asset]: { mimeType: "image/png", width: 1, height: 1, data: new Uint8Array() } },
		sources: [],
	}),
);
const scrim = cover.file("ppt/media/image-1-2.png");
if (!scrim) throw new Error("the cover export wrote no scrim");
await Bun.write(`${directory}/scrim.png.base64`, `${Buffer.from(await scrim.async("uint8array")).toString("base64")}\n`);
