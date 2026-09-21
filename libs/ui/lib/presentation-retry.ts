import type { PresentationJSON } from "@slidesage/types";

export function getPresentationRetryDestination(
	presentation: PresentationJSON,
	presentationId: string,
) {
	const retry = presentation.status === "failed" ? presentation.failure?.retry : undefined;
	if (!retry) return null;

	// Decks that failed before the template was recorded on the retry options
	// still carry the selection at the top level of the document.
	const template = retry.template ?? presentation.template;

	// The research page refuses to generate without a template, so sending a
	// retry there without one bounces the reader to an empty generate form and
	// loses the saved sources. Prefilling that form instead keeps the settings.
	if (retry.research_payload?.sources.length && template) {
		return {
			to: "/generate/research",
			state: {
				prompt: retry.prompt,
				slideCount: retry.slide_count,
				detailLevel: retry.detail_level,
				tonality: retry.tonality,
				researchPayload: retry.research_payload,
				retryPresentationId: presentationId,
				...(retry.ai ? { ai: retry.ai } : {}),
				template,
			},
		};
	}

	return {
		to: "/generate",
		state: {
			retry: template ? { ...retry, template } : retry,
			retryPresentationId: presentationId,
		},
	};
}
