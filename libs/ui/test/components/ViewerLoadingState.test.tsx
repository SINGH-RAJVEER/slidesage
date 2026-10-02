/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { ViewerNavigationControls } from "@slidesage/ui/components/Viewer/ViewerNavigationControls";
import { ViewerSlideCarousel } from "@slidesage/ui/components/Viewer/ViewerSlideCarousel";
import { fireEvent, render } from "@testing-library/react";
import { createRef } from "react";

it("renders a blank loading slide before the deck is available", () => {
	const view = render(
		<ViewerSlideCarousel
			deck={null}
			visibleSlide={0}
			containerRef={createRef<HTMLDivElement>()}
			onSelectSlide={mock()}
			isWaitingForFirstSlide={true}
		/>,
	);

	expect(view.getByRole("option", { name: "Waiting for the presentation" })).toBeInTheDocument();
	expect(view.getByRole("img", { name: "Loading" })).toBeInTheDocument();
	expect(view.queryByRole("progressbar")).not.toBeInTheDocument();
});

it("reports the generation stage under the loading orb", () => {
	const view = render(
		<ViewerSlideCarousel
			deck={null}
			visibleSlide={0}
			containerRef={createRef<HTMLDivElement>()}
			onSelectSlide={mock()}
			isWaitingForFirstSlide={true}
			generation={{ stage: "drafting" }}
		/>,
	);

	expect(view.getByRole("progressbar", { name: "Generation progress" })).toHaveAttribute(
		"aria-valuenow",
		"55",
	);
	expect(view.getByText("Writing slides")).toBeInTheDocument();
});

it("names the research stage before the worker reports one", () => {
	const view = render(
		<ViewerSlideCarousel
			deck={null}
			visibleSlide={0}
			containerRef={createRef<HTMLDivElement>()}
			onSelectSlide={mock()}
			isWaitingForFirstSlide={true}
			generation={{ isResearching: true }}
		/>,
	);

	expect(view.getByText("Researching sources")).toBeInTheDocument();
});

it("waits at the queued position until the first stage event", () => {
	const view = render(
		<ViewerSlideCarousel
			deck={null}
			visibleSlide={0}
			containerRef={createRef<HTMLDivElement>()}
			onSelectSlide={mock()}
			isWaitingForFirstSlide={true}
			generation={{}}
		/>,
	);

	expect(view.getByText("Queued")).toBeInTheDocument();
});

it("keeps empty-presentation controls visible and disabled", () => {
	const view = render(
		<ViewerNavigationControls
			currentSlide={0}
			totalSlides={0}
			onFirst={mock()}
			onPrev={mock()}
			onNext={mock()}
			onLast={mock()}
			onExport={mock(async () => {})}
			downloadDisabled
		/>,
	);

	expect(view.getByRole("button", { name: "Download" })).toBeDisabled();
	expect(view.getByRole("button", { name: "Previous slide" })).toBeDisabled();
	expect(view.getByRole("button", { name: "Next slide" })).toBeDisabled();
});

it("offers cancellation while generation is pending", () => {
	const onCancelGeneration = mock();
	const view = render(
		<ViewerNavigationControls
			currentSlide={0}
			totalSlides={0}
			onFirst={mock()}
			onPrev={mock()}
			onNext={mock()}
			onLast={mock()}
			onCancelGeneration={onCancelGeneration}
		/>,
	);

	fireEvent.click(view.getByRole("button", { name: "Cancel generation" }));
	expect(onCancelGeneration).toHaveBeenCalledTimes(1);
});
