import { describe, expect, it } from "bun:test";
import type { PresentationJSON, PresentationRetryOptions } from "@slidesage/types";
import { getPresentationRetryDestination } from "../../lib/presentation-retry";

function failed(retryOverrides: Partial<PresentationRetryOptions> = {}): PresentationJSON {
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
	};
}

describe("presentation retry destination", () => {
	it("returns a retry with saved sources to the research page", () => {
		const destination = getPresentationRetryDestination(failed(), "abc");

		expect(destination?.to).toBe("/generate/research");
		expect(destination?.state).toMatchObject({ retryPresentationId: "abc" });
	});

	it("takes the approved outline to the research page with its sources", () => {
		const plan = {
			title: "Quantum computing",
			cards: [
				{ position: 1, takeaway: "Qubits", role: "opening", layout: "title", sourceIds: ["s1"] },
			],
		};
		const destination = getPresentationRetryDestination(failed({ plan }), "abc");

		expect(destination?.state).toMatchObject({ plan });
	});

	it("prefills the generate form when no sources were saved", () => {
		const destination = getPresentationRetryDestination(
			failed({ research_enabled: false, research_payload: undefined }),
			"abc",
		);

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
