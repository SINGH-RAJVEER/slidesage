import { type CardDocument, validateCardDocument } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { useStreaming } from "@slidesage/ui";
import type { CardAsset } from "@slidesage/ui/components/Cards";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { CenteredStatusScreen, deckFromPreview } from "@slidesage/ui/components/Viewer";
import { API_URL } from "@slidesage/ui/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "../../app/router/paths";
import { DeckViewer } from "./DeckViewer";
import { DeckWorkspace } from "./DeckWorkspace";
import { loadPresentationDetail, loadPresentationDocument } from "./presentation-data";

type LoadState =
	| { status: "loading" }
	| { status: "generating" }
	| {
			status: "ready";
			/** The deck this document belongs to, which the route may have left. */
			presentationId: string;
			document: CardDocument;
			revision: number;
			sources: Source[];
			assets: Record<string, CardAsset>;
	  };

/** What the library shows when a presentation cannot be opened. */
export interface LibraryNotice {
	notice: string;
}

/** Opens a presentation: live progress while it generates, then its saved card document. */
export default function PresentationPage() {
	const { presentationId = "" } = useParams();
	const navigate = useNavigate();
	const { streamingState, cancelGeneration } = useStreaming();
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [notice, setNotice] = useState<string | null>(null);
	// A document loaded for another deck is never shown or edited here.
	const ready = state.status === "ready" && state.presentationId === presentationId;
	const shown = useRef(false);
	shown.current = ready;
	// Only the latest load may update the page, so a slow answer for the deck
	// the user left cannot replace the one they opened.
	const latestLoad = useRef(0);
	// An AI revision keeps the deck on screen; only a generation replaces it
	// with progress.
	const jobHere = streamingState.isStreaming && streamingState.presentationId === presentationId;
	const generatingHere = jobHere && streamingState.operation !== "iteration";
	const revisingHere = jobHere && streamingState.operation === "iteration";

	// A presentation that cannot be opened goes back to the library, which says
	// why. One already on screen stays there and reports a failed reload.
	const fail = useCallback(
		(message: string) => {
			if (shown.current) {
				setNotice(message);
				return;
			}
			const state: LibraryNotice = { notice: message };
			navigate(ROUTES.presentations, { replace: true, state });
		},
		[navigate],
	);

	// The first load of a deck may use what hovering its card prefetched. Every
	// later one, after a generation, a revision, or a retry, asks the server.
	const loadedId = useRef<string | null>(null);

	const load = useCallback(async () => {
		const request = ++latestLoad.current;
		const current = () => request === latestLoad.current;
		const fresh = loadedId.current === presentationId;
		try {
			const detail = await loadPresentationDetail(presentationId, { fresh });
			if (!current()) return;
			if (!detail.ok) {
				fail(detail.message ?? "Presentation not found");
				return;
			}
			const summary = detail.data.presentation.slides_data;
			if (summary.status === "failed") {
				navigate(`${ROUTES.presentationError}?id=${encodeURIComponent(presentationId)}`, {
					replace: true,
				});
				return;
			}
			if (summary.status === "generating") {
				setState({ status: "generating" });
				return;
			}
			const documentResult = await loadPresentationDocument(presentationId, { fresh });
			if (!current()) return;
			if (!documentResult.ok) {
				fail(documentResult.message ?? "Unable to load the presentation");
				return;
			}
			const body = documentResult.data;
			// The document is checked against the same schema the converter
			// enforced, so a malformed object is reported rather than rendered.
			const assets = body.assets ?? {};
			const validated = validateCardDocument(body.document, {
				knownAssets: new Set(Object.keys(assets)),
			});
			if (!validated.ok) {
				fail("This presentation's saved document could not be read.");
				return;
			}
			setState({
				status: "ready",
				presentationId,
				document: validated.value,
				revision: body.revision.revision,
				sources: summary.sources ?? [],
				assets,
			});
		} catch {
			if (current()) fail("Unable to load the presentation. Check your connection.");
		} finally {
			// Set only once a load settles, so the second run of a StrictMode
			// effect still shares the first one's prefetched answer.
			if (current()) loadedId.current = presentationId;
		}
	}, [fail, navigate, presentationId]);

	// Reload whenever a generation for this deck starts or stops, so the saved
	// document replaces the progress view the moment it is committed.
	useEffect(() => {
		if (generatingHere) {
			// Whatever was prefetched predates this generation.
			loadedId.current = presentationId;
			setState({ status: "generating" });
			return;
		}
		void load();
	}, [generatingHere, revisingHere, load, presentationId]);

	const [isCancelling, setIsCancelling] = useState(false);
	const cancel = async () => {
		setIsCancelling(true);
		if (await cancelGeneration()) {
			navigate(ROUTES.generate, { replace: true });
			return;
		}
		setIsCancelling(false);
	};

	if (state.status === "loading" || (state.status === "ready" && !ready)) {
		return <CenteredStatusScreen message="Loading presentation..." />;
	}

	if (state.status === "generating") {
		const preview = generatingHere ? streamingState.preview : undefined;
		return (
			<DeckViewer
				title={preview?.title || streamingState.prompt || "Untitled presentation"}
				deck={
					preview
						? deckFromPreview(
								preview,
								(assetId) =>
									`${API_URL}/presentations/${encodeURIComponent(presentationId)}/assets/${assetId}`,
								streamingState.theme,
							)
						: null
				}
				onBack={() => navigate(ROUTES.presentations)}
				isWaiting
				generation={
					generatingHere
						? {
								stage: streamingState.generationStage,
								message: streamingState.generationMessage,
								isResearching: streamingState.researchStatus === "searching",
							}
						: undefined
				}
				onCancelGeneration={
					generatingHere && streamingState.jobId ? () => void cancel() : undefined
				}
				cancelDisabled={isCancelling}
			/>
		);
	}

	return (
		<>
			<FloatingNotice error={notice} onDismiss={() => setNotice(null)} />
			<DeckWorkspace
				key={`${state.presentationId}:${state.revision}`}
				presentationId={presentationId}
				document={state.document}
				revision={state.revision}
				sources={state.sources}
				assets={state.assets}
				onReload={() => void load()}
			/>
		</>
	);
}
