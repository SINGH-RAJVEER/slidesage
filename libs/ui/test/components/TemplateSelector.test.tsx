/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import TemplateSelector, {
	centredAlignOffset,
	type InstalledTemplateOption,
} from "@slidesage/ui/components/Generate/TemplateSelector";
import { fireEvent, render } from "@testing-library/react";

function theme(id: string, name: string, version = 1): InstalledTemplateOption {
	return {
		marketplaceId: id,
		name,
		description: `${name} is a PowerPoint template in 16:9 format.`,
		templateReference: { id, version },
		thumbnailPath: `pptx-templates/${id}/1/thumbnails/cover.webp`,
	};
}

const INSTALLED = [
	theme("simple-business-proposal", "Simple Business Proposal"),
	theme("soft-skills-training", "Soft Skills Training"),
	theme("minimalist-marketing-annual-report", "Marketing Annual Report"),
];

const openSelector = (
	installedThemes: InstalledTemplateOption[] = INSTALLED,
	onTemplateRemove?: (option: InstalledTemplateOption) => void,
) => {
	const onTemplateChange = mock();
	const view = render(
		<TemplateSelector
			selectedTemplate={{ id: "simple-business-proposal", version: 1 }}
			onTemplateChange={onTemplateChange}
			onTemplateRemove={onTemplateRemove}
			installedThemes={installedThemes}
		/>,
	);
	fireEvent.pointerDown(view.getByRole("button", { name: /Simple Business Proposal/ }), {
		button: 0,
	});
	return { view, onTemplateChange };
};

it("lists the installed themes and lets a published one be chosen", () => {
	const { view, onTemplateChange } = openSelector();

	expect(view.getAllByRole("menuitem")).toHaveLength(3);

	const available = view.getByRole("menuitem", { name: /Soft Skills Training/ });
	expect(available.hasAttribute("data-disabled")).toBe(false);
	fireEvent.click(available);
	expect(onTemplateChange).toHaveBeenCalledWith({ id: "soft-skills-training", version: 1 });
});

// Publication is what makes a template usable, so one whose package was never
// uploaded has to stay unselectable however it reaches the menu.
it("disables an installed template version that has no published package", () => {
	const { view, onTemplateChange } = openSelector([
		theme("strategic-media-planning", "Strategic Media Planning", 2),
	]);

	const unavailable = view.getByRole("menuitem", { name: /Strategic Media Planning/ });
	expect(unavailable.hasAttribute("data-disabled")).toBe(true);
	fireEvent.click(unavailable);
	expect(onTemplateChange).not.toHaveBeenCalled();
});

// Categories describe what a template is for, which is what the reader is
// choosing between.
it("groups themes into a column per category", () => {
	const { view } = openSelector();

	const headings = view
		.getAllByText(
			/^(Business & Finance|Marketing & Social|Education & Training|Creative & Lifestyle)$/,
		)
		.map((node) => node.textContent);
	expect(headings).toEqual(["Business & Finance", "Marketing & Social", "Education & Training"]);

	const business = view.getByText("Business & Finance").parentElement;
	expect(business?.contains(view.getByRole("menuitem", { name: /Simple Business Proposal/ }))).toBe(
		true,
	);
});

// The menu widens rather than scrolling, so a category taller than one column
// continues into the next one instead of growing a scrollbar.
it("spills a long category into another column and widens the menu", () => {
	const manyEducation = [
		theme("5s-training", "5S Training"),
		theme("soft-skills-training", "Soft Skills Training"),
		theme("grade-1-addition", "Grade 1 Addition"),
		theme("geometric-mathematics-lesson", "Mathematics Lesson"),
		theme("illustrative-mathematics-quiz", "Mathematics Quiz"),
		theme("middle-school-functions-lesson", "Functions Lesson"),
		theme("pink-doodles-math-online-class", "Math Online Class"),
		theme("fun-doodles-welcome-to-math-class", "Math Class Doodles"),
		theme("renaissance-odyssey-language-arts", "The Odyssey Language Arts"),
		theme("saving-and-investment", "Saving and Investment"),
	];
	const { view } = openSelector(manyEducation);

	const content = view.baseElement.querySelector(
		'[data-slot="dropdown-menu-content"]',
	) as HTMLElement;
	const grid = content.querySelector("div.grid") as HTMLElement;

	expect(grid.children).toHaveLength(2);
	expect(content.style.width).toBe("30rem");
	// The heading is not repeated over the continuation column.
	expect(view.getAllByText("Education & Training")).toHaveLength(1);
});

it("removes a theme from its own row and leaves the menu open", () => {
	const onTemplateRemove = mock();
	const { view } = openSelector(INSTALLED, onTemplateRemove);

	fireEvent.click(view.getByRole("button", { name: "Remove Soft Skills Training" }));

	expect(onTemplateRemove).toHaveBeenCalledTimes(1);
	expect(onTemplateRemove.mock.calls[0]?.[0]).toMatchObject({
		marketplaceId: "soft-skills-training",
	});
	expect(view.getByRole("menuitem", { name: /Simple Business Proposal/ })).toBeInTheDocument();
});

// The remove control is a sibling of the row rather than a child, so it sits
// outside the menu's roving focus and needs a keyboard path of its own.
it("removes a theme with Delete on its row", () => {
	const onTemplateRemove = mock();
	const { view } = openSelector(INSTALLED, onTemplateRemove);

	fireEvent.keyDown(view.getByRole("menuitem", { name: /Marketing Annual Report/ }), {
		key: "Delete",
	});

	expect(onTemplateRemove.mock.calls[0]?.[0]).toMatchObject({
		marketplaceId: "minimalist-marketing-annual-report",
	});
});

it("says so when the reader has removed every theme", () => {
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
		centredAlignOffset({
			columnCount: 4,
			triggerLeft: 400,
			viewportWidth: 1440,
			rootFontSize: 16,
		}),
	).toBe(-160);

	// A trigger already at the centred position needs no shift.
	expect(
		centredAlignOffset({
			columnCount: 4,
			triggerLeft: 240,
			viewportWidth: 1440,
			rootFontSize: 16,
		}),
	).toBe(0);

	// A panel wider than the page is capped at 92vw and centred on what is left.
	expect(
		centredAlignOffset({
			columnCount: 6,
			triggerLeft: 0,
			viewportWidth: 1000,
			rootFontSize: 16,
		}),
	).toBe(40);
});
