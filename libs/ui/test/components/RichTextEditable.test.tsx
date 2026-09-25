import { describe, expect, it } from "bun:test";
import type { RichText } from "@slidesage/cards";
import { htmlToRuns, runsToHtml } from "../../components/Cards";

function parse(html: string): RichText {
	const container = document.createElement("div");
	container.innerHTML = html;
	return htmlToRuns(container);
}

describe("rich text editing", () => {
	it("round-trips every combination of emphasis", () => {
		const runs: RichText = [
			{ text: "Plain " },
			{ text: "bold", bold: true },
			{ text: " and " },
			{ text: "italic", italic: true },
			{ text: " and " },
			{ text: "both", bold: true, italic: true },
			{ text: " <tags> & ampersands" },
		];
		expect(parse(runsToHtml(runs))).toEqual(runs);
	});

	it("keeps only text from markup the browser or a paste inserts", () => {
		expect(
			parse(
				'Hi <a href="https://x.test">there</a><script>alert(1)</script><img src=x onerror=1><br>friend',
			),
		).toEqual([{ text: "Hi therealert(1) friend" }]);
	});

	it("reads emphasis the browser wrote as inline styles", () => {
		expect(
			parse(
				'<span style="font-weight: 700">Loud</span> <span style="font-style: italic">soft</span>',
			),
		).toEqual([{ text: "Loud", bold: true }, { text: " " }, { text: "soft", italic: true }]);
	});

	it("trims outer whitespace and collapses inner runs of it", () => {
		expect(parse("  Two   spaces\n here  ")).toEqual([{ text: "Two spaces here" }]);
	});
});
