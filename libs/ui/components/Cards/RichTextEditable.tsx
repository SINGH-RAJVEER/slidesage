import { normalizeRuns, type RichText, type TextRun } from "@slidesage/cards";
import { cn } from "@slidesage/ui/lib/utils";
import { type KeyboardEvent, useLayoutEffect, useRef } from "react";

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders runs as the only markup the editor accepts back: strong and em. */
export function runsToHtml(runs: RichText): string {
	return runs
		.map((run) => {
			let html = escapeHtml(run.text);
			if (run.italic) html = `<em>${html}</em>`;
			if (run.bold) html = `<strong>${html}</strong>`;
			return html;
		})
		.join("");
}

/**
 * Reads edited DOM back into runs. Bold and italic survive, whether the
 * browser wrote them as tags or inline styles; every other element is reduced
 * to its text, so nothing the browser or a paste inserts can reach the
 * document as markup.
 */
export function htmlToRuns(root: Node): RichText {
	const runs: TextRun[] = [];
	const walk = (node: Node, bold: boolean, italic: boolean) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = (node.textContent ?? "").replace(/\s+/g, " ");
			if (text) {
				const run: TextRun = { text };
				if (bold) run.bold = true;
				if (italic) run.italic = true;
				runs.push(run);
			}
			return;
		}
		if (!(node instanceof Element)) return;
		if (node.tagName === "BR") {
			runs.push({ text: " " });
			return;
		}
		const style = node instanceof HTMLElement ? node.style : undefined;
		const weight = style?.fontWeight ?? "";
		const nextBold =
			bold ||
			node.tagName === "STRONG" ||
			node.tagName === "B" ||
			weight === "bold" ||
			Number(weight) >= 600;
		const nextItalic =
			italic || node.tagName === "EM" || node.tagName === "I" || style?.fontStyle === "italic";
		for (const child of Array.from(node.childNodes)) walk(child, nextBold, nextItalic);
	};
	for (const child of Array.from(root.childNodes)) walk(child, false, false);
	const merged = normalizeRuns(runs);
	// Leading and trailing whitespace belongs to no run.
	if (merged[0]) merged[0] = { ...merged[0], text: merged[0].text.replace(/^\s+/, "") };
	const last = merged[merged.length - 1];
	if (last) merged[merged.length - 1] = { ...last, text: last.text.replace(/\s+$/, "") };
	return normalizeRuns(merged);
}

export interface RichTextEditableProps {
	value: RichText;
	onChange: (value: RichText) => void;
	/** Plain fields such as stat labels take no emphasis. */
	plain?: boolean;
	label: string;
	className?: string;
}

/**
 * An inline editor for one text field. The element is written imperatively and
 * only while it is not focused, so React never moves the caret mid-edit.
 */
export function RichTextEditable({
	value,
	onChange,
	plain,
	label,
	className,
}: RichTextEditableProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const html = runsToHtml(value);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || element === document.activeElement) return;
		if (element.innerHTML !== html) element.innerHTML = html;
	}, [html]);

	const emit = () => {
		const element = ref.current;
		if (!element) return;
		const runs = htmlToRuns(element);
		onChange(plain ? [{ text: runs.map((run) => run.text).join("") }] : runs);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.currentTarget.blur();
			return;
		}
		const shortcut = event.metaKey || event.ctrlKey;
		if (shortcut && !plain && (event.key === "b" || event.key === "i")) {
			event.preventDefault();
			document.execCommand(event.key === "b" ? "bold" : "italic");
			emit();
		}
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: a native input cannot hold bold and italic runs, so a contenteditable span carries the textbox role
		<span
			ref={ref}
			role="textbox"
			aria-label={label}
			aria-multiline={false}
			tabIndex={0}
			contentEditable
			suppressContentEditableWarning
			spellCheck
			className={cn(
				"cursor-text rounded-[0.3cqw] outline-none transition-shadow focus:ring-2 focus:ring-sky-400/60 hover:ring-1 hover:ring-current/20",
				className,
			)}
			onInput={emit}
			onBlur={() => {
				emit();
				const element = ref.current;
				if (element) element.innerHTML = runsToHtml(htmlToRuns(element));
			}}
			onKeyDown={onKeyDown}
			onPaste={(event) => {
				event.preventDefault();
				const text = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
				document.execCommand("insertText", false, text);
				emit();
			}}
		/>
	);
}
