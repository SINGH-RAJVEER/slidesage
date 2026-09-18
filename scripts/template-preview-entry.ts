import {
	buildPresentation,
	materializeSlideNodes,
	type PresentationData,
	parseZip,
	renderSlide,
	type SlideHandle,
} from "@aiden0z/pptx-renderer";

let presentation: PresentationData | undefined;
let activeSlide: SlideHandle | undefined;

async function loadPresentation(bytes: Uint8Array) {
	activeSlide?.dispose();
	activeSlide = undefined;
	presentation = buildPresentation(await parseZip(bytes as unknown as ArrayBuffer));
	return {
		slideCount: presentation.slides.length,
		width: presentation.width,
		height: presentation.height,
	};
}

async function renderSlideAt(index: number, width: number) {
	if (!presentation) throw new Error("presentation is not loaded");
	const slide = presentation.slides[index];
	if (!slide) throw new Error(`slide ${index} does not exist`);

	activeSlide?.dispose();
	materializeSlideNodes(presentation, slide);
	activeSlide = renderSlide(presentation, slide);
	await activeSlide.ready;

	const scale = width / presentation.width;
	const height = Math.round(presentation.height * scale);
	const stage = document.getElementById("stage");
	if (!stage) throw new Error("stage is missing");
	stage.style.width = `${width}px`;
	stage.style.height = `${height}px`;
	activeSlide.element.style.transformOrigin = "top left";
	activeSlide.element.style.transform = `scale(${scale})`;
	stage.replaceChildren(activeSlide.element);
	await document.fonts?.ready;
	return { width, height };
}

declare global {
	interface Window {
		loadPresentation: typeof loadPresentation;
		renderSlideAt: typeof renderSlideAt;
	}
}

window.loadPresentation = loadPresentation;
window.renderSlideAt = renderSlideAt;
