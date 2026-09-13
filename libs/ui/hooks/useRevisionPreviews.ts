import type { PptxViewer } from "@aiden0z/pptx-renderer";
import type { PresentationRevision } from "@slidesage/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { fetchPresentationRevision } from "../lib/presentation-revision";

export interface PreviewDocument {
	viewer: PptxViewer | null;
	slideCount: number;
	slides: string[];
}
export type RevisionStatus = PresentationRevision;

interface BrowserRevision {
	revision: number;
	viewer: PptxViewer;
}

export function useRevisionPreviews(
	id: string | undefined,
	revisionNumber?: number,
	enabled = true,
	selectedRevision?: number,
) {
	const [revision, setRevision] = useState<RevisionStatus | null>(null);
	const [error, setError] = useState<string>();
	const [browserRevision, setBrowserRevision] = useState<BrowserRevision | null>(null);
	const [browserError, setBrowserError] = useState<string>();
	const [refresh, setRefresh] = useState(0);
	const reload = useCallback(() => setRefresh((value) => value + 1), []);
	useEffect(() => {
		setRevision(null);
		setError(undefined);
		if (!id || !enabled) return;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		async function poll() {
			try {
				const response = await fetch(
					`${API_URL}/presentations/${id}/revision/status${selectedRevision ? `?revision=${selectedRevision}` : ""}`,
					{ credentials: "include", signal: controller.signal },
				);
				if (!response.ok)
					throw new Error(
						response.status === 409
							? "This presentation has no PPTX revision. Regenerate it to use the viewer and editor."
							: "Could not load revision status.",
					);
				const current: RevisionStatus = await response.json();
				if (controller.signal.aborted) return;
				setRevision(current);
				setError(undefined);
				// Editor final saves can arrive after the iframe closes. Keep observing the current pointer.
				timer = setTimeout(
					() => void poll(),
					current.previewStatus === "pending" || current.previewStatus === "rendering"
						? 2000
						: 10000,
				);
			} catch (cause) {
				if (controller.signal.aborted) return;
				setError(cause instanceof Error ? cause.message : "Could not load previews.");
				timer = setTimeout(() => void poll(), 10000);
			}
		}
		void poll();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [id, revisionNumber, enabled, refresh, selectedRevision]);

	const activeRevision = revision?.revision;
	const expectedSlideCount = revision?.slideCount;
	useEffect(() => {
		setBrowserRevision(null);
		setBrowserError(undefined);
		if (!id || !enabled || activeRevision === undefined || expectedSlideCount === undefined) return;

		const controller = new AbortController();
		let loadedViewer: PptxViewer | null = null;
		const requestedRevision = activeRevision;

		void (async () => {
			try {
				const bytes = await fetchPresentationRevision(id, controller.signal, requestedRevision);
				const {
					PptxViewer: BrowserPptxViewer,
					RECOMMENDED_ZIP_LIMITS,
					buildPresentation,
					parseZipLazyMedia,
				} = await import("@aiden0z/pptx-renderer");
				if (controller.signal.aborted) return;

				const files = await parseZipLazyMedia(bytes, RECOMMENDED_ZIP_LIMITS);
				if (controller.signal.aborted) return;
				const presentation = buildPresentation(files, { lazySlides: true });
				if (presentation.slides.length !== expectedSlideCount) {
					throw new Error("The PowerPoint slide count does not match its revision.");
				}

				loadedViewer = new BrowserPptxViewer(document.createElement("div"));
				loadedViewer.load(presentation);
				if (controller.signal.aborted) {
					loadedViewer.destroy();
					loadedViewer = null;
					return;
				}
				setBrowserRevision({ revision: requestedRevision, viewer: loadedViewer });
			} catch (cause) {
				if (controller.signal.aborted) return;
				setBrowserError(
					cause instanceof Error
						? cause.message
						: "Could not render the PowerPoint in this browser.",
				);
			}
		})();

		return () => {
			controller.abort();
			loadedViewer?.destroy();
		};
	}, [activeRevision, enabled, expectedSlideCount, id]);

	const retry = async () => {
		if (!id || !revision) return;
		try {
			const response = await fetch(
				`${API_URL}/presentations/${id}/revisions/${revision.revision}/previews/retry`,
				{ method: "POST", credentials: "include" },
			);
			if (!response.ok) throw new Error("Could not schedule previews. Please try again.");
			reload();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not schedule previews.");
		}
	};
	const imageSlides = useMemo(
		() =>
			revision?.previewStatus === "ready"
				? Array.from(
						{ length: revision.previewCount },
						(_, index) =>
							`${API_URL}/presentations/${id}/revisions/${revision.revision}/previews/${index}`,
					)
				: [],
		[id, revision],
	);
	const browserViewer =
		browserRevision && browserRevision.revision === revision?.revision
			? browserRevision.viewer
			: null;
	const previewDocument: PreviewDocument | null = revision
		? browserViewer
			? { viewer: browserViewer, slideCount: browserViewer.slideCount, slides: imageSlides }
			: imageSlides.length > 0
				? { viewer: null, slideCount: revision.slideCount, slides: imageSlides }
				: null
		: null;
	const resolvedError =
		error ?? (browserError && revision?.previewStatus === "failed" ? browserError : undefined);
	return {
		document: previewDocument,
		revision,
		error: resolvedError,
		browserError,
		reload,
		retry,
		isLoading: enabled && !!id && !previewDocument && !resolvedError,
	};
}
