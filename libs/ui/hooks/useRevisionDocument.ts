import type { PptxViewer } from "@aiden0z/pptx-renderer";
import type { PresentationRevision } from "@slidesage/types";
import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { fetchPresentationRevision } from "../lib/presentation-revision";
import type { ViewerDocument } from "../lib/viewer-document";

interface BrowserRevision {
	revision: number;
	document: ViewerDocument;
}

export function useRevisionDocument(
	id: string | undefined,
	revisionNumber?: number,
	enabled = true,
	selectedRevision?: number,
) {
	const [revision, setRevision] = useState<PresentationRevision | null>(null);
	const [browserRevision, setBrowserRevision] = useState<BrowserRevision | null>(null);
	const [error, setError] = useState<string>();
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
					`${API_URL}/presentations/${id}/revision/metadata${selectedRevision ? `?revision=${selectedRevision}` : ""}`,
					{ credentials: "include", signal: controller.signal },
				);
				if (!response.ok) {
					throw new Error(
						response.status === 409
							? "This presentation has no PPTX revision. Regenerate it to use the viewer."
							: "Could not load the presentation revision.",
					);
				}
				const current: PresentationRevision = await response.json();
				if (controller.signal.aborted) return;
				setRevision(current);
				setError(undefined);
				timer = setTimeout(() => void poll(), 10000);
			} catch (cause) {
				if (controller.signal.aborted) return;
				setError(cause instanceof Error ? cause.message : "Could not load the presentation.");
				timer = setTimeout(() => void poll(), 10000);
			}
		}

		void poll();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [enabled, id, refresh, revisionNumber, selectedRevision]);

	const activeRevision = revision?.revision;
	const expectedSlideCount = revision?.slideCount;
	useEffect(() => {
		setBrowserRevision(null);
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
				setBrowserRevision({
					revision: requestedRevision,
					document: { kind: "pptx", viewer: loadedViewer, slideCount: loadedViewer.slideCount },
				});
			} catch (cause) {
				if (controller.signal.aborted) return;
				setError(
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

	const viewerDocument =
		browserRevision && browserRevision.revision === revision?.revision
			? browserRevision.document
			: null;
	return {
		document: viewerDocument,
		revision,
		error,
		reload,
		isLoading: enabled && !!id && !viewerDocument && !error,
	};
}
