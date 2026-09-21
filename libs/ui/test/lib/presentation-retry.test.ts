import { describe, expect, it } from "bun:test";
import type { PresentationJSON, PresentationRetryOptions } from "@slidesage/types";
import { getPresentationRetryDestination } from "../../lib/presentation-retry";

const template = { id: "soft-skills-training", version: 1 };

function failed(
	retryOverrides: Partial<PresentationRetryOptions> = {},
	documentOverrides: Partial<PresentationJSON> = {},
): PresentationJSON {
	const retry: PresentationRetryOptions = {
		prompt: "Quantum computing",
		slide_count: 8,
		detail_level: "detailed",
		tonality: "persuasive",
		research_enabled: true,
		research_payload: { sources: [{ url: "https://example.com", title: "Saved source" }] },
		...retryOverrides,
	};

	return {
		title: "Generation failed",
		status: "failed",
		failure: { message: "Failed", retry },
		...documentOverrides,
	};
}

describe("presentation retry destination", () => {
	it("carries the saved template to the research page", () => {
		const destination = getPresentationRetryDestination(failed({ template }), "abc");

		expect(destination?.to).toBe("/generate/research");
		expect(destination?.state).toMatchObject({ template, retryPresentationId: "abc" });
	});

	it("falls back to the template stored on the document", () => {
		const destination = getPresentationRetryDestination(failed({}, { template }), "abc");

		expect(destination?.to).toBe("/generate/research");
		expect(destination?.state).toMatchObject({ template });
	});

	// The research page cannot generate without a template, so a deck that
	// failed before templates were recorded prefills the generate form instead
	// of being bounced off the research page into an empty one.
	it("prefills the generate form when no template was saved", () => {
		const destination = getPresentationRetryDestination(failed(), "abc");

		expect(destination?.to).toBe("/generate");
		expect(destination?.state).toMatchObject({
			retryPresentationId: "abc",
			retry: { prompt: "Quantum computing", slide_count: 8 },
		});
	});

	it("ignores presentations that are not failed", () => {
		const ready: PresentationJSON = { title: "Ready" };

		expect(getPresentationRetryDestination(ready, "abc")).toBeNull();
	});
});
