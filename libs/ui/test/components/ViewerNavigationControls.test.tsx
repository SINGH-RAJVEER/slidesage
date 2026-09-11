/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { ViewerNavigationControls } from "@slidesage/ui/components/Viewer/ViewerNavigationControls";
import { fireEvent, render } from "@testing-library/react";
import type React from "react";

const renderControls = (
	overrides: Partial<React.ComponentProps<typeof ViewerNavigationControls>> = {},
) => {
	const onDeleteSlide = mock();
	const props: React.ComponentProps<typeof ViewerNavigationControls> = {
		currentSlide: 1,
		totalSlides: 4,
		onFirst: mock(),
		onPrev: mock(),
		onNext: mock(),
		onLast: mock(),
		showDownload: false,
		onDeleteSlide,
		...overrides,
	};

	return { view: render(<ViewerNavigationControls {...props} />), onDeleteSlide };
};

it("asks to delete the slide on screen", () => {
	const { view, onDeleteSlide } = renderControls();

	fireEvent.click(view.getByRole("button", { name: "Delete slide" }));

	expect(onDeleteSlide).toHaveBeenCalledTimes(1);
});

it("refuses to delete the last remaining slide", () => {
	const { view, onDeleteSlide } = renderControls({ currentSlide: 0, totalSlides: 1 });
	const remove = view.getByRole("button", { name: "Delete slide" });

	expect(remove).toBeDisabled();
	fireEvent.click(remove);

	expect(onDeleteSlide).not.toHaveBeenCalled();
});

it("offers cancelling a generation instead of deleting a slide", () => {
	const { view, onDeleteSlide } = renderControls({
		onCancelGeneration: mock(),
		totalSlides: 0,
		currentSlide: 0,
	});

	expect(view.queryByRole("button", { name: "Delete slide" })).toBeNull();
	expect(view.getByRole("button", { name: /Cancel generation/ })).toBeTruthy();
	expect(onDeleteSlide).not.toHaveBeenCalled();
});
