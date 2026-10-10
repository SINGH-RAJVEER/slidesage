import type { PresentationJSON } from "@slidesage/types";

export function getPresentationRetryDestination(
	presentation: PresentationJSON,
	presentationId: string,
) {
	const retry = presentation.status === "failed" ? presentation.failure?.retry : undefined;
	if (!retry) return null;

	// A retry with reviewed sources returns to the research page so the saved
	// sources are not lost. The approved outline goes with them; it cites those
	// sources by position.
	if (retry.research_payload?.sources.length) {
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
				...(retry.theme ? { theme: retry.theme } : {}),
				...(retry.plan ? { plan: retry.plan } : {}),
			},
		};
	}

	return {
		to: "/generate",
		state: { retry, retryPresentationId: presentationId },
	};
}
