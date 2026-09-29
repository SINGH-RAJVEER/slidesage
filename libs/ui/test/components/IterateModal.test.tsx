/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import IterateModal from "@slidesage/ui/components/Viewer/IterateModal";
import { fireEvent, render } from "@testing-library/react";

const props = { onOpenChange: mock(), isStreaming: false, currentSlide: 3 };

it("renders a single accessible form only while open", () => {
	const onOpenChange = mock(() => {});
	const view = render(
		<IterateModal {...props} open={true} onOpenChange={onOpenChange} onIterate={mock()} />,
	);

	expect(view.getAllByRole("textbox")).toHaveLength(1);
	expect(document.querySelectorAll("#iteratePrompt")).toHaveLength(1);
	fireEvent.click(view.getByRole("button", { name: "Close iterate sidebar" }));
	expect(onOpenChange).toHaveBeenCalledWith(false);

	view.unmount();
	const closedView = render(<IterateModal {...props} open={false} onIterate={mock()} />);
	const closedPanel = closedView.getByLabelText("Iterate on presentation");
	expect(closedPanel).toHaveClass("viewer-iterate-panel--closed");
	expect(closedPanel).toHaveAttribute("aria-hidden", "true");
});

it("revises every slide unless the slide on screen is chosen", () => {
	const onIterate = mock(() => {});
	const view = render(<IterateModal {...props} open={true} onIterate={onIterate} />);

	fireEvent.input(view.getByRole("textbox"), { target: { value: "Strengthen the evidence" } });
	fireEvent.click(view.getByRole("button", { name: "Generate revision" }));
	expect(onIterate).toHaveBeenLastCalledWith("Strengthen the evidence", "deck");

	fireEvent.click(view.getByRole("button", { name: "Slide 3" }));
	fireEvent.click(view.getByRole("button", { name: "Generate revision" }));
	expect(onIterate).toHaveBeenLastCalledWith("Strengthen the evidence", "slide");
});

it("opens on the scope it was asked for", () => {
	const view = render(
		<IterateModal {...props} open={true} onIterate={mock()} initialScope="slide" />,
	);

	expect(view.getByRole("button", { name: "Slide 3" })).toHaveAttribute("aria-pressed", "true");
	expect(view.getByRole("button", { name: "Every slide" })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
});

it("submits a quick change at once", () => {
	const onIterate = mock(() => {});
	const view = render(<IterateModal {...props} open={true} onIterate={onIterate} />);

	fireEvent.click(view.getByRole("button", { name: "Make it more concise" }));
	expect(onIterate).toHaveBeenCalledWith("Make it more concise", "deck");
});

it("submits on Enter but preserves Shift+Enter for multiline prompts", () => {
	const onIterate = mock(() => {});
	const view = render(<IterateModal {...props} open={true} onIterate={onIterate} />);
	const prompt = view.getByRole("textbox");
	fireEvent.input(prompt, { target: { value: "Add a conclusion" } });

	fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
	expect(onIterate).not.toHaveBeenCalled();
	fireEvent.keyDown(prompt, { key: "Enter" });
	expect(onIterate).toHaveBeenCalledTimes(1);
});

it("retains the prompt when a revision request fails", async () => {
	const onIterate = mock(async () => false);
	const view = render(<IterateModal {...props} open={true} onIterate={onIterate} />);
	fireEvent.input(view.getByRole("textbox"), { target: { value: "Keep my requested changes" } });
	fireEvent.keyDown(view.getByRole("textbox"), { key: "Enter" });
	await Promise.resolve();
	expect(view.getByRole("textbox")).toHaveValue("Keep my requested changes");
});

it("holds the instruction to the length the server accepts", () => {
	const view = render(<IterateModal {...props} open={true} onIterate={mock()} />);

	expect(view.getByRole("textbox")).toHaveAttribute("maxlength", "400");
});
