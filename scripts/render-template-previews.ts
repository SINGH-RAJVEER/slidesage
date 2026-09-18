/**
 * Renders every slide of staged, sanitized template packages with the same
 * browser renderer used by the presentation viewer.
 *
 *   go -C apps/api run ./cmd/publish-templates -source ../../templates/v1 -out ../../.published-templates
 *   bun scripts/render-template-previews.ts --source .published-templates --out .published-templates
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PluginBuilder } from "bun";
import { chromium, type Page } from "playwright";

interface DigestRecord {
	sha256: string;
	byteSize: number;
	slideCount: number;
	objectPath: string;
}

interface Options {
	source: string;
	out: string;
	digests: string;
	only: Set<string>;
	width: number;
	smallWidth: number;
	coverWidth: number;
	quality: number;
}

interface PreviewWindow {
	loadPresentation(bytes: Uint8Array): Promise<{
		slideCount: number;
		width: number;
		height: number;
	}>;
	renderSlideAt(index: number, width: number): Promise<{ width: number; height: number }>;
}

function parseArgs(argv: string[]): Options {
	const flags = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg?.startsWith("--")) flags.set(arg.slice(2), argv[index + 1] ?? "");
	}
	return {
		source: flags.get("source") ?? ".published-templates",
		out: flags.get("out") ?? flags.get("source") ?? ".published-templates",
		digests: flags.get("digests") ?? "libs/types/src/template-digests.json",
		only: new Set((flags.get("only") ?? "").split(",").filter(Boolean)),
		width: Number(flags.get("width") ?? 1600),
		smallWidth: Number(flags.get("small-width") ?? 480),
		coverWidth: Number(flags.get("cover-width") ?? 1280),
		quality: Number(flags.get("quality") ?? 82),
	};
}

const HARNESS = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}#stage{position:relative;overflow:hidden}</style>
<div id="stage"></div>`;

async function encodeWebP(page: Page, png: Buffer, width: number, quality: number) {
	const encoded = await page.evaluate(
		async ([sourceBase64, outputWidth, outputQuality]) => {
			const source = await fetch(`data:image/png;base64,${sourceBase64}`).then((response) =>
				response.blob(),
			);
			const bitmap = await createImageBitmap(source);
			const targetWidth = Number(outputWidth);
			const targetHeight = Math.round((bitmap.height / bitmap.width) * targetWidth);
			const canvas = new OffscreenCanvas(targetWidth, targetHeight);
			canvas.getContext("2d")?.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
			const blob = await canvas.convertToBlob({
				type: "image/webp",
				quality: Number(outputQuality) / 100,
			});
			if (blob.type !== "image/webp") throw new Error(`browser encoded ${blob.type}`);
			const bytes = new Uint8Array(await blob.arrayBuffer());
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return btoa(binary);
		},
		[png.toString("base64"), String(width), String(quality)] as const,
	);
	return Buffer.from(encoded, "base64");
}

async function write(path: string, contents: Uint8Array | string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const digests = JSON.parse(await readFile(options.digests, "utf8")) as Record<
		string,
		DigestRecord
	>;
	const entries = Object.entries(digests)
		.filter(([id]) => options.only.size === 0 || options.only.has(id))
		.sort(([left], [right]) => left.localeCompare(right));
	if (entries.length === 0) throw new Error("no published templates matched");

	const build = await Bun.build({
		entrypoints: ["scripts/template-preview-entry.ts"],
		target: "browser",
		minify: true,
		root: ".",
		conditions: ["browser", "import"],
		external: [],
		naming: "template-preview-entry.js",
		plugins: [
			{
				name: "resolve-from-ui",
				setup(builder: PluginBuilder) {
					builder.onResolve({ filter: /^@aiden0z\/pptx-renderer$/ }, () => ({
						path: Bun.resolveSync("@aiden0z/pptx-renderer", `${process.cwd()}/libs/ui`),
					}));
				},
			},
		],
	});
	if (!build.success) throw new AggregateError(build.logs, "failed to bundle the renderer");
	const bundle = await build.outputs[0]?.text();
	if (!bundle) throw new Error("renderer bundle was empty");

	const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];
	const browser = await chromium.launch(executablePath ? { executablePath } : {});
	let rendered = 0;
	let failed = 0;
	try {
		for (const [id, record] of entries) {
			let page: Page | undefined;
			try {
				page = await browser.newPage({ viewport: { width: options.width, height: options.width } });
				await page.setContent(HARNESS);
				await page.addScriptTag({ content: bundle, type: "module" });
				const packageBytes = await readFile(join(options.source, record.objectPath));
				const info = await page.evaluate(async (encoded) => {
					const binary = atob(encoded);
					const bytes = new Uint8Array(binary.length);
					for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
					return (window as unknown as PreviewWindow).loadPresentation(bytes);
				}, packageBytes.toString("base64"));
				if (info.slideCount !== record.slideCount) {
					throw new Error(
						`expected ${record.slideCount} slides, renderer found ${info.slideCount}`,
					);
				}

				const prefix = join(
					options.out,
					"pptx-templates",
					id,
					record.objectPath.split("/")[2] ?? "",
					record.sha256,
					"previews",
					"v1",
				);
				for (let index = 0; index < info.slideCount; index += 1) {
					await page.evaluate(
						([slideIndex, width]) =>
							(window as unknown as PreviewWindow).renderSlideAt(Number(slideIndex), Number(width)),
						[String(index), String(options.width)] as const,
					);
					const png = await page.locator("#stage").screenshot({ type: "png" });
					const [full, small] = await Promise.all([
						encodeWebP(page, png, options.width, options.quality),
						encodeWebP(page, png, options.smallWidth, options.quality),
					]);
					await Promise.all([
						write(join(prefix, `${index}.webp`), full),
						write(join(prefix, "small", `${index}.webp`), small),
					]);
					if (index === 0) {
						const cover = await encodeWebP(page, png, options.coverWidth, options.quality);
						await write(
							join(
								options.out,
								"pptx-templates",
								id,
								record.objectPath.split("/")[2] ?? "",
								"thumbnails",
								"cover.webp",
							),
							cover,
						);
					}
				}
				await write(
					join(prefix, "manifest.json"),
					`${JSON.stringify({ slideCount: info.slideCount })}\n`,
				);
				rendered += 1;
				console.log(`rendered  ${id.padEnd(52)} ${info.slideCount} slides`);
			} catch (error) {
				failed += 1;
				console.log(`FAIL      ${id.padEnd(52)} ${(error as Error).message}`);
			} finally {
				await page?.close().catch(() => {});
			}
		}
	} finally {
		await browser.close();
	}

	console.log(`\n${rendered} rendered, ${failed} failed -> ${options.out}`);
	if (failed > 0) process.exit(1);
}

await main();
