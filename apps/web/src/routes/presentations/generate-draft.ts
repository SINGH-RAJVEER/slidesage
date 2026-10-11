import type { PresentationRetryOptions } from "@slidesage/types";
import { MAX_RESEARCH_RESULTS } from "@slidesage/ui/components/Generate";
import { isRecord } from "../../hooks/usePageDraft";

export interface GenerateDraft {
	prompt: string;
	slideCount: string;
	detailLevel: string;
	tonality: string;
	useWebResearch: boolean;
	researchResultCount: number;
	selectedTemplateId?: string;
	retry?: PresentationRetryOptions;
	retryPresentationId?: string;
}

export function isGenerateDraft(value: unknown): value is GenerateDraft {
	return (
		isRecord(value) &&
		typeof value["prompt"] === "string" &&
		typeof value["slideCount"] === "string" &&
		/^(?:[5-9]|[12]\d|3\d|40)$/.test(value["slideCount"]) &&
		typeof value["detailLevel"] === "string" &&
		typeof value["tonality"] === "string" &&
		typeof value["useWebResearch"] === "boolean" &&
		typeof value["researchResultCount"] === "number" &&
		Number.isInteger(value["researchResultCount"]) &&
		value["researchResultCount"] >= 1 &&
		value["researchResultCount"] <= MAX_RESEARCH_RESULTS &&
		(value["selectedTemplateId"] === undefined ||
			typeof value["selectedTemplateId"] === "string") &&
		(value["retryPresentationId"] === undefined ||
			typeof value["retryPresentationId"] === "string") &&
		(value["retry"] === undefined || isRecord(value["retry"]))
	);
}
