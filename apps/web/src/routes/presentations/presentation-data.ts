import type {
	PresentationResponse,
	PresentationStatus,
	PresentationsResponse,
} from "@slidesage/types";
import type { CardAsset } from "@slidesage/ui/components/Cards";
import { type ApiResult, getJson } from "@slidesage/ui/lib/api";
import { evictPrefetched, prefetch, takePrefetched } from "@slidesage/ui/lib/prefetch";

export const PRESENTATIONS_PAGE_SIZE = 20;

/** The saved card document as the API returns it, before it is validated. */
export interface PresentationDocumentBody {
	document: unknown;
	revision: { revision: number };
	assets?: Record<string, CardAsset>;
}

const LIBRARY_KEY = "presentations:first-page";
const presentationKey = (presentationId: string) => `presentation:${presentationId}:`;
const detailKey = (presentationId: string) => `${presentationKey(presentationId)}detail`;
const documentKey = (presentationId: string) => `${presentationKey(presentationId)}document`;

export function fetchPresentationsPage(offset: number): Promise<ApiResult<PresentationsResponse>> {
	return getJson(`/presentations?limit=${PRESENTATIONS_PAGE_SIZE}&offset=${offset}`);
}

const fetchDetail = (presentationId: string) =>
	getJson<PresentationResponse>(`/presentations/${presentationId}`);

const fetchDocument = (presentationId: string) =>
	getJson<PresentationDocumentBody>(`/presentations/${presentationId}/document`);

/** Loads the library's first page before the user opens it. */
export function prefetchLibrary(): void {
	prefetch(LIBRARY_KEY, () => fetchPresentationsPage(0)).catch(() => {});
}

/** The library's first page, prefetched if the user hovered their way here. */
export function takeLibrary(): Promise<ApiResult<PresentationsResponse>> {
	return takePrefetched(LIBRARY_KEY, () => fetchPresentationsPage(0));
}

/**
 * Loads what opening a presentation needs before the user clicks it. Only a
 * ready deck has a saved document to load.
 */
export function prefetchPresentation(presentationId: string, status?: PresentationStatus): void {
	prefetchPresentationDetail(presentationId).catch(() => {});
	if (status === "ready") {
		prefetch(documentKey(presentationId), () => fetchDocument(presentationId)).catch(() => {});
	}
}

/** A presentation's detail, kept for the page that opens it next. */
export function prefetchPresentationDetail(
	presentationId: string,
): Promise<ApiResult<PresentationResponse>> {
	return prefetch(detailKey(presentationId), () => fetchDetail(presentationId));
}

/** A presentation's detail, prefetched unless the page asks for a fresh copy. */
export function loadPresentationDetail(
	presentationId: string,
	{ fresh }: { fresh: boolean },
): Promise<ApiResult<PresentationResponse>> {
	if (fresh) return fetchDetail(presentationId);
	return takePrefetched(detailKey(presentationId), () => fetchDetail(presentationId));
}

/** A presentation's saved document, prefetched unless the page asks for a fresh copy. */
export function loadPresentationDocument(
	presentationId: string,
	{ fresh }: { fresh: boolean },
): Promise<ApiResult<PresentationDocumentBody>> {
	if (fresh) return fetchDocument(presentationId);
	return takePrefetched(documentKey(presentationId), () => fetchDocument(presentationId));
}

/** Forgets anything prefetched for a presentation that has changed or gone. */
export function evictPresentation(presentationId: string): void {
	evictPrefetched(presentationKey(presentationId));
	evictPrefetched(LIBRARY_KEY);
}
