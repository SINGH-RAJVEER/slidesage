import { type CardDocument, validateCardDocument } from "@slidesage/cards";
import type { ApiErrorResponse, PresentationResponse, Source } from "@slidesage/types";
import { useStreaming } from "@slidesage/ui";
import { Button } from "@slidesage/ui/components/button";
import type { CardAsset } from "@slidesage/ui/components/Cards";
import { Progress } from "@slidesage/ui/components/progress";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { API_URL } from "@slidesage/ui/lib/api";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { DeckWorkspace } from "./DeckWorkspace";

type LoadState =
	| { status: "loading" }
	| { status: "generating" }
	| {
			status: "ready";
			document: CardDocument;
			revision: number;
			sources: Source[];
			assets: Record<string, CardAsset>;
	  }
	| { status: "error"; message: string };

async function errorMessage(response: Response, fallback: string): Promise<string> {
	const body = (await response.json().catch(() => null)) as ApiErrorResponse | null;
	return body?.error?.message ?? fallback;
}

/** Opens a presentation: live progress while it generates, then its saved card document. */
export default function PresentationPage() {
	const { presentationId = "" } = useParams();
	const navigate = useNavigate();
	const { streamingState, cancelGeneration } = useStreaming();
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const generatingHere = streamingState.isStreaming && streamingState.presentationId === presentationId;

	const load = useCallback(async () => {
		try {
			const detailResponse = await fetch(`${API_URL}/presentations/${presentationId}`, {
				credentials: "include",
			});
			if (!detailResponse.ok) {
				setState({ status: "error", message: await errorMessage(detailResponse, "Presentation not found") });
				return;
			}
			const detail = (await detailResponse.json()) as PresentationResponse;
			const summary = detail.presentation.slides_data;
			if (summary.status === "failed") {
				navigate(`${ROUTES.presentationError}?id=${encodeURIComponent(presentationId)}`, { replace: true });
				return;
			}
			if (summary.status === "generating") {
				setState({ status: "generating" });
				return;
			}
			const documentResponse = await fetch(`${API_URL}/presentations/${presentationId}/document`, {
				credentials: "include",
			});
			if (!documentResponse.ok) {
				setState({
					status: "error",
					message: await errorMessage(documentResponse, "Unable to load the presentation"),
				});
				return;
			}
			const body = (await documentResponse.json()) as {
				document: unknown;
				revision: { revision: number };
				assets?: Record<string, CardAsset>;
			};
			// The document is checked against the same schema the converter
			// enforced, so a malformed object is reported rather than rendered.
			const assets = body.assets ?? {};
			const validated = validateCardDocument(body.document, {
				knownAssets: new Set(Object.keys(assets)),
			});
			if (!validated.ok) {
				setState({ status: "error", message: "This presentation's saved document could not be read." });
				return;
			}
			setState({
				status: "ready",
				document: validated.value,
				revision: body.revision.revision,
				sources: summary.sources ?? [],
				assets,
			});
		} catch {
			setState({ status: "error", message: "Unable to load the presentation. Check your connection." });
		}
	}, [navigate, presentationId]);

	// Reload whenever a generation for this deck starts or stops, so the saved
	// document replaces the progress view the moment it is committed.
	useEffect(() => {
		if (generatingHere) {
			setState({ status: "generating" });
			return;
		}
		void load();
	}, [generatingHere, load]);

	const progress = streamingState.generationProgress;
	const percent = progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0;

	return (
		<div className="flex min-h-dvh w-full flex-col bg-transparent">
			<Header />
			<main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 md:px-8">
				{state.status === "loading" && (
					<p className="text-sm text-white/50" role="status">
						Loading presentation
					</p>
				)}
				{state.status === "generating" && (
					<section className="flex flex-1 flex-col items-center justify-center gap-6" aria-live="polite">
						<ThinkingOrb size={64} />
						<div className="flex w-full max-w-sm flex-col items-center gap-3">
							<p className="text-sm text-white/70">
								{generatingHere
									? (streamingState.generationMessage ?? "Queued")
									: "This presentation is still generating"}
							</p>
							{generatingHere && <Progress value={percent} aria-label="Generation progress" />}
						</div>
						{generatingHere && (
							<Button variant="ghost" onClick={() => void cancelGeneration()}>
								Cancel generation
							</Button>
						)}
					</section>
				)}
				{state.status === "error" && (
					<section className="flex flex-1 flex-col items-center justify-center gap-4" role="alert">
						<p className="text-sm text-white/70">{state.message}</p>
						<Button variant="ghost" onClick={() => navigate(ROUTES.presentations)}>
							Back to presentations
						</Button>
					</section>
				)}
				{state.status === "ready" && (
					<DeckWorkspace
						key={state.revision}
						presentationId={presentationId}
						document={state.document}
						revision={state.revision}
						sources={state.sources}
						assets={state.assets}
						onReload={() => void load()}
					/>
				)}
			</main>
		</div>
	);
}
