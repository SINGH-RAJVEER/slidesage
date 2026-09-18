/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import IterateModal from "@slidesage/ui/components/Viewer/IterateModal";
import { fireEvent, render } from "@testing-library/react";

it("renders a single accessible form only while open", () => {
	const onOpenChange = mock(() => {});
	const view = render(
		<IterateModal open={true} onOpenChange={onOpenChange} onIterate={mock()} isStreaming={false} />,
	);

	expect(view.getAllByRole("textbox")).toHaveLength(1);
	expect(document.querySelectorAll("#iteratePrompt")).toHaveLength(1);
	fireEvent.click(view.getByRole("button", { name: "Close iterate sidebar" }));
	expect(onOpenChange).toHaveBeenCalledWith(false);

	view.unmount();
	const closedView = render(
		<IterateModal open={false} onOpenChange={mock()} onIterate={mock()} isStreaming={false} />,
	);
	const closedPanel = closedView.getByLabelText("Iterate on presentation");
	expect(closedPanel).toHaveClass("viewer-iterate-panel--closed");
	expect(closedPanel).toHaveAttribute("aria-hidden", "true");
});

it("submits the selected generation settings including the slide count", () => {
	const onIterate = mock(() => {});
	const view = render(
		<IterateModal open={true} onOpenChange={mock()} onIterate={onIterate} isStreaming={false} />,
	);

	fireEvent.input(view.getByRole("textbox"), { target: { value: "Strengthen the evidence" } });
	fireEvent.click(view.getByRole("button", { name: "Detailed" }));
	fireEvent.click(view.getByRole("button", { name: "Casual" }));
	fireEvent.click(view.getByRole("button", { name: "Web Research" }));
	const count = view.getByRole("slider", { name: "Slide count" });
	expect(count).toHaveTextContent("5");
	fireEvent.keyDown(count, { key: "ArrowRight" });
	fireEvent.keyDown(count, { key: "ArrowRight" });
	expect(count).toHaveTextContent("7");
	fireEvent.click(view.getByRole("button", { name: "Generate revision" }));

	expect(onIterate).toHaveBeenCalledWith("Strengthen the evidence", 7, "detailed", "casual", true);
	expect(view.getByRole("textbox")).toHaveValue("Strengthen the evidence");
});

it("submits on Enter but preserves Shift+Enter for multiline prompts", () => {
	const onIterate = mock(() => {});
	const view = render(
		<IterateModal open={true} onOpenChange={mock()} onIterate={onIterate} isStreaming={false} />,
	);
	const prompt = view.getByRole("textbox");
	fireEvent.input(prompt, { target: { value: "Add a conclusion" } });

	fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
	expect(onIterate).not.toHaveBeenCalled();
	fireEvent.keyDown(prompt, { key: "Enter" });
	expect(onIterate).toHaveBeenCalledTimes(1);
});

it("retains the prompt when a revision request fails", async () => {
	const onIterate = mock(async () => false);
	const view = render(
		<IterateModal open={true} onOpenChange={mock()} onIterate={onIterate} isStreaming={false} />,
	);
	fireEvent.input(view.getByRole("textbox"), { target: { value: "Keep my requested changes" } });
	fireEvent.keyDown(view.getByRole("textbox"), { key: "Enter" });
	await Promise.resolve();
	expect(view.getByRole("textbox")).toHaveValue("Keep my requested changes");
});

it("uses the existing deck count and displays submission errors", () => {
	const onIterate = mock(() => false);
	const view = render(
		<IterateModal
			open={true}
			onOpenChange={mock()}
			onIterate={onIterate}
			isStreaming={false}
			currentSlideCount={12}
			error="Insufficient points"
		/>,
	);
	expect(view.getByRole("slider", { name: "Slide count" })).toHaveAttribute("aria-valuenow", "12");
	expect(view.getByRole("alert")).toHaveTextContent("Insufficient points");
	fireEvent.input(view.getByRole("textbox"), { target: { value: "Rewrite the conclusion" } });
	fireEvent.keyDown(view.getByRole("textbox"), { key: "Enter" });
	expect(onIterate).toHaveBeenCalledWith(
		"Rewrite the conclusion",
		12,
		"balanced",
		"professional",
		false,
	);
});

it("allows reducing and increasing the current count within 1 to 40", () => {
	const onIterate = mock(() => false);
	const view = render(
		<IterateModal
			open={true}
			onOpenChange={mock()}
			onIterate={onIterate}
			isStreaming={false}
			currentSlideCount={12}
		/>,
	);
	fireEvent.input(view.getByRole("textbox"), { target: { value: "Reshape the deck" } });
	const count = view.getByRole("slider", { name: "Slide count" });
	expect(count).toHaveAttribute("aria-valuemin", "1");
	expect(count).toHaveAttribute("aria-valuemax", "40");
	fireEvent.keyDown(count, { key: "Home" });
	fireEvent.keyDown(count, { key: "ArrowLeft" });
	fireEvent.click(view.getByRole("button", { name: "Generate revision" }));
	expect(onIterate).toHaveBeenLastCalledWith(
		"Reshape the deck",
		1,
		"balanced",
		"professional",
		false,
	);
	fireEvent.keyDown(count, { key: "End" });
	fireEvent.keyDown(count, { key: "ArrowRight" });
	fireEvent.click(view.getByRole("button", { name: "Generate revision" }));
	expect(onIterate).toHaveBeenLastCalledWith(
		"Reshape the deck",
		40,
		"balanced",
		"professional",
		false,
	);
	expect(view.getByText(/Fewer slides condenses the content/)).toBeInTheDocument();
});

it("resets to the loaded count on reopen and when the deck changes", () => {
	const props = { onOpenChange: mock(), onIterate: mock(), isStreaming: false };
	const view = render(<IterateModal {...props} open={true} currentSlideCount={3} />);
	fireEvent.keyDown(view.getByRole("slider"), { key: "ArrowRight" });
	expect(view.getByRole("slider")).toHaveAttribute("aria-valuenow", "4");
	view.rerender(<IterateModal {...props} open={false} currentSlideCount={3} />);
	view.rerender(<IterateModal {...props} open={true} currentSlideCount={3} />);
	expect(view.getByRole("slider")).toHaveAttribute("aria-valuenow", "3");
	view.rerender(<IterateModal {...props} open={true} currentSlideCount={1} />);
	expect(view.getByRole("slider")).toHaveAttribute("aria-valuenow", "1");
});
