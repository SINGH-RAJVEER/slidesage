import { type CardDocument, validateCardDocument } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { type CardAsset, CardDeck, PresentMode } from "@slidesage/ui/components/Cards";
import { SlideSageLogo } from "@slidesage/ui/components/SlideSageLogo";
import { API_URL } from "@slidesage/ui/lib/api";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ROUTES } from "../../app/router/paths";

type SharedState =
	| { status: "loading" }
	| { status: "missing" }
	| { status: "error"; message: string }
	| {
			status: "ready";
			document: CardDocument;
			sources: Source[];
			assets: Record<string, CardAsset>;
	  };

/** A deck opened from a share link: readable and presentable, without an account. */
export default function SharedPresentationPage() {
	const { token = "" } = useParams();
	const [state, setState] = useState<SharedState>({ status: "loading" });
	const [presenting, setPresenting] = useState(false);
	const sharedUrl = `${API_URL}/shared/${encodeURIComponent(token)}`;

	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const response = await fetch(sharedUrl);
				if (response.status === 404) {
					if (active) setState({ status: "missing" });
					return;
				}
				if (!response.ok) throw new Error();
				const body = (await response.json()) as {
					document: unknown;
					sources?: Source[];
					assets?: Record<string, CardAsset>;
				};
				const assets = body.assets ?? {};
				const validated = validateCardDocument(body.document, {
					knownAssets: new Set(Object.keys(assets)),
				});
				if (!active) return;
				setState(
					validated.ok
						? { status: "ready", document: validated.value, sources: body.sources ?? [], assets }
						: { status: "error", message: "This presentation could not be read." },
				);
			} catch {
				if (active) {
					setState({
						status: "error",
						message: "Unable to load the presentation. Check your connection.",
					});
				}
			}
		})();
		return () => {
			active = false;
		};
	}, [sharedUrl]);

	useEffect(() => {
		if (state.status === "ready") window.document.title = `${state.document.title} · SlideSage`;
	}, [state]);

	const assetUrl = (assetId: string) => `${sharedUrl}/assets/${assetId}`;

	return (
		<div className="flex min-h-dvh w-full flex-col bg-transparent">
			<header className="flex items-center px-6 py-4">
				<Link to={ROUTES.landing} aria-label="SlideSage">
					<SlideSageLogo className="h-8 w-auto" />
				</Link>
			</header>
			<main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 md:px-8">
				{state.status === "loading" && (
					<p className="text-sm text-white/50" role="status">
						Loading presentation
					</p>
				)}
				{(state.status === "missing" || state.status === "error") && (
					<section className="flex flex-1 flex-col items-center justify-center gap-2" role="alert">
						<p className="text-sm text-white/70">
							{state.status === "missing"
								? "This link is not valid. It may have been turned off by its owner."
								: state.message}
						</p>
					</section>
				)}
				{state.status === "ready" && (
					<>
						<div className="flex flex-wrap items-center gap-3">
							<h1 className="min-w-0 flex-1 text-2xl font-semibold text-white">
								{state.document.title}
							</h1>
							<Button
								variant="ghost"
								onClick={() => setPresenting(true)}
								className="gap-2 text-white/80 hover:bg-white/10 hover:text-white"
							>
								<Play className="size-4" />
								Present
							</Button>
						</div>
						<CardDeck
							document={state.document}
							sources={state.sources}
							assets={state.assets}
							assetUrl={assetUrl}
						/>
						{presenting && (
							<PresentMode
								document={state.document}
								sources={state.sources}
								assets={state.assets}
								assetUrl={assetUrl}
								onExit={() => setPresenting(false)}
							/>
						)}
					</>
				)}
			</main>
		</div>
	);
}
