/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { WebResearchToggle } from "@slidesage/ui/components/Generate/WebResearchToggle";
import { fireEvent, render } from "@testing-library/react";

it("drags from anywhere on the button, snaps the result count on release, and toggles on a plain press", () => {
	const onEnabledChange = mock();
	const onResultCountChange = mock();
	const view = render(
		<WebResearchToggle
			enabled
			resultCount={5}
			onEnabledChange={onEnabledChange}
			onResultCountChange={onResultCountChange}
		/>,
	);
	const button = view.getByRole("button", { name: "Web Research" });
	const handle = view.getByRole("slider", { name: "Research results" });
	const container = handle.parentElement as HTMLElement;
	container.getBoundingClientRect = () => ({ left: 100, width: 160 }) as DOMRect;

	// The press lands well away from the fill edge and the fill does not jump to it.
	fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 230 });
	fireEvent.pointerMove(button, { pointerId: 1, clientX: 232 });
	expect(container).toHaveAttribute("data-dragging", "false");
	fireEvent.pointerMove(button, { pointerId: 1, clientX: 186 });
	expect(container).toHaveAttribute("data-dragging", "true");
	expect(handle.style.left).toBe("35%");
	expect(view.getByText("3")).toBeInTheDocument();
	expect(onResultCountChange).not.toHaveBeenCalled();
	fireEvent.pointerUp(button, { pointerId: 1 });
	fireEvent.click(button);
	expect(onResultCountChange).toHaveBeenLastCalledWith(3);
	expect(container).toHaveAttribute("data-dragging", "false");
	expect(onEnabledChange).not.toHaveBeenCalled();

	fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 200 });
	fireEvent.pointerMove(button, { pointerId: 1, clientX: 0 });
	fireEvent.pointerUp(button, { pointerId: 1 });
	expect(onResultCountChange).toHaveBeenLastCalledWith(1);

	fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 200 });
	fireEvent.pointerUp(button, { pointerId: 1 });
	fireEvent.click(button);
	expect(onEnabledChange).toHaveBeenCalledWith(false);
});
