import type { PresentationRevision } from "@slidesage/types";
import { API_URL } from "./api";

/**
 * Fetches the bytes of a presentation's current revision.
 *
 * A presentation is its PPTX revision, so this is both what the viewer renders
 * and what Download saves; there is no second representation to keep in step.
 * The endpoint is served by the API rather than the CDN because revisions are
 * private to their owner.
 */
export async function fetchPresentationRevision(
	presentationId: string,
	signal?: AbortSignal,
	revision?: number,
	format: "pptx" | "pdf" = "pptx",
): Promise<ArrayBuffer> {
	const path =
		format === "pdf"
			? `revisions/${revision}/pdf`
			: `revision${revision ? `?revision=${revision}` : ""}`;
	const response = await fetch(`${API_URL}/presentations/${presentationId}/${path}`, {
		credentials: "include",
		signal,
	});
	if (!response.ok) {
		throw new Error(`Could not load presentation revision (${response.status})`);
	}
	return response.arrayBuffer();
}

/**
 * Deletes one slide from a presentation and returns the revision that replaces
 * the current one.
 *
 * A revision is immutable, so nothing is erased: the deck without the slide is
 * committed as the next revision, and the revision picker still reaches the one
 * that had it. The revision the viewer is showing is sent along, so a deck that
 * moved on elsewhere is rejected rather than silently rewritten.
 */
export async function deletePresentationSlide(
	presentationId: string,
	revision: number,
	slideIndex: number,
): Promise<PresentationRevision> {
	const response = await fetch(
		`${API_URL}/presentations/${presentationId}/revisions/${revision}/slides/${slideIndex}`,
		{ method: "DELETE", credentials: "include" },
	);
	if (!response.ok) {
		const reason = (await response.text()).trim();
		throw new Error(reason || "Could not delete the slide. Please try again.");
	}
	return response.json();
}
