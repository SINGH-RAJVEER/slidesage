/// <reference lib="dom" />

import { afterEach, expect, it, mock } from "bun:test";
import type { ViewerDocument } from "@slidesage/ui/lib/viewer-document";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const generate = mock(async () => false);
let loadedDocument: ViewerDocument | null = {
	kind: "images",
	slides: ["/slide.png"],
	slideCount: 1,
};
mock.module("@slidesage/ui", () => ({
	useStreaming: () => ({ streamingState: {}, generate }),
}));
mock.module("@slidesage/ui/hooks/usePresentationData", () => ({
	usePresentationData: () => ({
		presentation: { title: "Deck", totalSlides: 12, currentRevision: { revision: 9 } },
		presentationId: "deck_1",
		isLoading: false,
		shouldShowGenerating: false,
	}),
}));
mock.module("@slidesage/ui/hooks/useRevisionDocument", () => ({
	useRevisionDocument: () => ({
		document: loadedDocument,
		revision: { revision: 7, slideCount: 1 },
		isLoading: !loadedDocument,
	}),
}));

const { default: PresentationViewer } = await import(
	"../../../routes/presentations/PresentationViewer"
);
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	generate.mockClear();
	loadedDocument = { kind: "images", slides: ["/slide.png"], slideCount: 1 };
});

it("iterates from the displayed revision and edited count without requiring a client template", async () => {
	globalThis.fetch = mock(async () => Response.json([])) as unknown as typeof fetch;
	const view = render(
		<MemoryRouter>
			<PresentationViewer />
		</MemoryRouter>,
	);
	fireEvent.click(view.getByRole("button", { name: "Iterate presentation" }));
	const count = view.getByRole("slider", { name: "Slide count" });
	await act(async () => {});
	expect(count).toHaveAttribute("aria-valuenow", "1");
	fireEvent.keyDown(count, { key: "ArrowRight" });
	fireEvent.input(view.getByRole("textbox"), { target: { value: "Expand the explanation" } });
	fireEvent.click(view.getByRole("button", { name: "Generate revision" }));
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({
			parentPresentationId: "deck_1",
			baseRevision: 7,
			slideCount: 2,
			template: undefined,
		}),
	);
});

it("cannot iterate when revision metadata exists but its document has not loaded", async () => {
	globalThis.fetch = mock(async () => Response.json([])) as unknown as typeof fetch;
	loadedDocument = null;
	const view = render(
		<MemoryRouter>
			<PresentationViewer />
		</MemoryRouter>,
	);
	await act(async () => {});
	expect(view.getByRole("button", { name: "Iterate presentation" })).toBeDisabled();
	expect(generate).not.toHaveBeenCalled();
});
