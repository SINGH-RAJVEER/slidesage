import type { ApiErrorResponse, PresentationResponse } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { API_URL, readJsonResponse } from "@slidesage/ui/lib/api";
import { getPresentationRetryDestination } from "@slidesage/ui/lib/presentation-retry";
import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";

type LoadResult = { presentation: PresentationResponse["presentation"] } | { error: string };

async function loadFailedPresentation(presentationId: string): Promise<LoadResult> {
	try {
		const response = await fetch(`${API_URL}/presentations/${presentationId}`, {
			credentials: "include",
		});
		const result = await readJsonResponse<PresentationResponse | ApiErrorResponse>(response);

		if (response.status === 401) return { error: "Your session expired. Please sign in again." };
		if (!result) {
			return { error: "The presentation service returned an invalid response. Try again." };
		}
		if (!response.ok || "error" in result) {
			const message = "error" in result ? result.error.message : undefined;
			return { error: message || "Unable to open this retry." };
		}
		return { presentation: result.presentation };
	} catch (requestError) {
		return {
			error: requestError instanceof Error ? requestError.message : "Unable to open this retry.",
		};
	}
}

interface PresentationErrorPageProps {
	presentationId?: number | string;
	onDelete?: () => void;
}

export default function PresentationErrorPage({
	presentationId: propPresentationId,
	onDelete,
}: PresentationErrorPageProps = {}) {
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const [isRetrying, setIsRetrying] = useState(false);
	const [retryError, setRetryError] = useState("");
	const [failureMessage, setFailureMessage] = useState("");
	const load = useRef<{ id: string; result: Promise<LoadResult> } | null>(null);

	// A reload drops history state, so the id in the URL keeps retry reachable.
	const presentationId =
		location.state?.presentationId || propPresentationId || searchParams.get("id") || undefined;

	// Retry reuses the load that showed the failure, including one still in
	// flight, so opening the page and retrying asks the API once.
	const loadPresentation = useCallback((id: string) => {
		if (load.current?.id !== id) load.current = { id, result: loadFailedPresentation(id) };
		return load.current.result;
	}, []);

	// The saved failure says why generation stopped, so the reason survives a
	// reload and a visit from the library rather than leaving with the stream.
	useEffect(() => {
		if (!presentationId) return;
		const id = String(presentationId);
		let active = true;
		void loadPresentation(id).then((result) => {
			if (!active) return;
			if ("error" in result) {
				if (load.current?.id === id) load.current = null;
				return;
			}
			const slidesData = result.presentation.slides_data;
			setFailureMessage(slidesData.status === "failed" ? (slidesData.failure?.message ?? "") : "");
		});
		return () => {
			active = false;
		};
	}, [loadPresentation, presentationId]);

	const handleRetry = async () => {
		if (!presentationId || isRetrying) return;

		setIsRetrying(true);
		setRetryError("");

		const id = String(presentationId);
		const result = await loadPresentation(id);
		setIsRetrying(false);

		if ("error" in result) {
			if (load.current?.id === id) load.current = null;
			setRetryError(result.error);
			return;
		}

		const destination = getPresentationRetryDestination(
			result.presentation.slides_data,
			result.presentation.id,
		);
		if (!destination) {
			setRetryError("The saved retry settings are unavailable.");
			return;
		}

		navigate(destination.to, { state: destination.state });
	};

	const handleDelete = async () => {
		if (onDelete) {
			onDelete();
		} else if (presentationId) {
			try {
				const response = await fetch(`${API_URL}/presentations/${presentationId}`, {
					method: "DELETE",
					credentials: "include",
				});

				if (response.ok) {
					navigate(ROUTES.presentations);
				}
			} catch (err) {
				console.error("Failed to delete presentation:", err);
			}
		}
	};

	return (
		<div className="flex min-h-screen flex-col bg-transparent">
			<Header />
			<FloatingNotice error={retryError} onDismiss={() => setRetryError("")} />
			<main className="flex flex-1 items-center px-6 py-12 md:px-10 md:py-16">
				<section aria-labelledby="presentation-error-title" className="mx-auto w-full max-w-3xl">
					<div className="max-w-2xl">
						<h1
							id="presentation-error-title"
							className="text-3xl font-semibold text-white md:text-4xl"
						>
							We couldn&apos;t finish this presentation
						</h1>
						{failureMessage && (
							<p role="alert" className="mt-3 text-sm leading-6 text-red-200">
								{failureMessage}
							</p>
						)}
						{presentationId && (
							<p className="mt-3 text-sm leading-6 text-white/45">
								Your prompt, generation settings, and available research sources are saved with this
								presentation.
							</p>
						)}
					</div>

					<div className="mt-10 rounded-lg border border-white/10 bg-black/20 p-5 md:p-6">
						<h2 className="text-sm font-semibold text-white/90">What you can do</h2>
						<ul className="mt-4 grid gap-3 text-sm leading-6 text-white/55 md:grid-cols-2">
							<li className="flex gap-3">
								<span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
								Retry here with the same saved prompt and generation settings.
							</li>
							<li className="flex gap-3">
								<span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
								Check your connection if generation stopped before any slides appeared.
							</li>
							<li className="flex gap-3">
								<span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
								Try a shorter topic or fewer slides if the request timed out.
							</li>
							<li className="flex gap-3">
								<span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
								Remove the failed presentation if you no longer need it.
							</li>
						</ul>
					</div>

					<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
						{presentationId && (
							<Button
								onClick={handleRetry}
								disabled={isRetrying}
								className="h-11 bg-white px-5 text-[#151c2a] hover:bg-white/90"
							>
								{isRetrying ? <ThinkingOrb size={20} /> : <RotateCcw className="h-4 w-4" />}
								{isRetrying ? "Opening retry..." : "Retry presentation"}
							</Button>
						)}

						{presentationId && (
							<Button
								onClick={handleDelete}
								variant="ghost"
								className="h-11 px-5 text-red-300 hover:bg-red-500/10 hover:text-red-200"
							>
								<Trash2 className="h-4 w-4" />
								Delete unfinished presentation
							</Button>
						)}
					</div>
				</section>
			</main>
		</div>
	);
}
