import { type CardDocument, validateCardDocument } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import type { CardAsset } from "@slidesage/ui/components/Cards";
import { SlideSageLogo } from "@slidesage/ui/components/SlideSageLogo";
import { CenteredStatusScreen, deckFromDocument } from "@slidesage/ui/components/Viewer";
import { API_URL } from "@slidesage/ui/lib/api";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "../../app/router/paths";
import { DeckViewer } from "./DeckViewer";

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
	const navigate = useNavigate();
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

	if (state.status === "loading") {
		return <CenteredStatusScreen message="Loading presentation..." />;
	}

	if (state.status === "ready") {
		return (
			<DeckViewer
				title={state.document.title}
				deck={deckFromDocument(state.document, {
					sources: state.sources,
					assets: state.assets,
					assetUrl: (assetId) => `${sharedUrl}/assets/${assetId}`,
				})}
				onBack={() => navigate(ROUTES.landing)}
				backLabel="SlideSage home"
			/>
		);
	}

	return (
		<div className="flex min-h-dvh w-full flex-col bg-transparent">
			<header className="flex items-center px-6 py-4">
				<Link to={ROUTES.landing} aria-label="SlideSage">
					<SlideSageLogo className="h-8 w-auto" />
				</Link>
			</header>
			<section className="flex flex-1 flex-col items-center justify-center gap-2 px-4" role="alert">
				<p className="text-sm text-white/70">
					{state.status === "missing"
						? "This link is not valid. It may have been turned off by its owner."
						: state.message}
				</p>
			</section>
		</div>
	);
}
