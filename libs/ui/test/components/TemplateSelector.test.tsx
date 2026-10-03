/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import TemplateSelector, {
	centredAlignOffset,
} from "@slidesage/ui/components/Generate/TemplateSelector";
import { fireEvent, render } from "@testing-library/react";

const INSTALLED = ["ocean-proposal", "grove-lesson", "sand-workshop", "mono-briefing"];

const openSelector = (
	installedTemplateIds: string[] = INSTALLED,
	onTemplateRemove?: (templateId: string) => void,
) => {
	const onTemplateChange = mock();
	const view = render(
		<TemplateSelector
			selectedTemplateId="ocean-proposal"
			onTemplateChange={onTemplateChange}
			onTemplateRemove={onTemplateRemove}
			installedTemplateIds={installedTemplateIds}
		/>,
	);
	fireEvent.pointerDown(view.getByRole("button", { name: /A better place to work/ }), {
		button: 0,
	});
	return { view, onTemplateChange };
};

it("lists the installed templates and lets one be chosen", () => {
	const { view, onTemplateChange } = openSelector();

	expect(view.getAllByRole("menuitem")).toHaveLength(4);

	fireEvent.click(view.getByRole("menuitem", { name: /How a forest works/ }));
	expect(onTemplateChange).toHaveBeenCalledWith("grove-lesson");
});

// Categories describe what a template is for, which is what the reader is
// choosing between. A category is one column however many it holds.
it("groups templates into a column per category", () => {
	const { view } = openSelector();

	const headings = view
		.getAllByText(/^(Business|Education|Creative|Research)$/)
		.map((node) => node.textContent);
	expect(headings).toEqual(["Business", "Education", "Research"]);

	const education = view.getByText("Education").parentElement;
	expect(education?.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
});

it("removes a template from its own row and leaves the menu open", () => {
	const onTemplateRemove = mock();
	const { view } = openSelector(INSTALLED, onTemplateRemove);

	fireEvent.click(view.getByRole("button", { name: "Remove How a forest works" }));

	expect(onTemplateRemove).toHaveBeenCalledWith("grove-lesson");
	expect(view.getByRole("menuitem", { name: /A better place to work/ })).toBeInTheDocument();
});

// The remove control is a sibling of the row rather than a child, so it sits
// outside the menu's roving focus and needs a keyboard path of its own.
it("removes a template with Delete on its row", () => {
	const onTemplateRemove = mock();
	const { view } = openSelector(INSTALLED, onTemplateRemove);

	fireEvent.keyDown(view.getAllByRole("menuitem")[3] as HTMLElement, { key: "Delete" });

	expect(onTemplateRemove).toHaveBeenCalledWith("mono-briefing");
});

it("says so when the reader has removed every template", () => {
	const { view } = openSelector([]);

	expect(view.getByText("No themes installed. Add one from the marketplace.")).toBeInTheDocument();
	expect(view.queryAllByRole("menuitem")).toHaveLength(0);
});

// The panel is a page-level surface rather than something hanging off a
// control, so it is centred on the page. No layout runs under jsdom, so the
// arithmetic is checked directly.
it("offsets a trigger-aligned panel onto the centre of the page", () => {
	// A 60rem panel on a 1440px page starts at (1440 - 960) / 2 = 240.
	expect(
		centredAlignOffset({ columnCount: 4, triggerLeft: 400, viewportWidth: 1440, rootFontSize: 16 }),
	).toBe(-160);

	// A trigger already at the centred position needs no shift.
	expect(
		centredAlignOffset({ columnCount: 4, triggerLeft: 240, viewportWidth: 1440, rootFontSize: 16 }),
	).toBe(0);

	// A panel wider than the page is capped at 92vw and centred on what is left.
	expect(
		centredAlignOffset({ columnCount: 6, triggerLeft: 0, viewportWidth: 1000, rootFontSize: 16 }),
	).toBe(40);
});
