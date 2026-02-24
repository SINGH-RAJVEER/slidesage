import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useStreaming } from "@/modules/presentations";
import type { ResearchPayload, Source } from "@/modules/types/presentation";
import { ROUTES } from "@/router/paths";

const API_URL = import.meta.env.VITE_API_URL;

interface ResearchRouteState {
	prompt: string;
	slideCount: number;
	detailLevel: string;
	tonality: string;
}

export default function GenerateResearchPage() {
	const location = useLocation();
	const navigate = useNavigate();
	const { streamingState, startStreaming, resetStreaming } = useStreaming();

	const routeState = location.state as ResearchRouteState | null;
	const prompt = routeState?.prompt?.trim() ?? "";
	const slideCount = routeState?.slideCount ?? 0;
	const detailLevel = routeState?.detailLevel ?? "balanced";
	const tonality = routeState?.tonality ?? "professional";

	const [summary, setSummary] = useState<string | null>(null);
	const [sources, setSources] = useState<Source[]>([]);
	const [tokensUsed, setTokensUsed] = useState<number | null>(null);
	const [tokensEstimated, setTokensEstimated] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [isProceeding, setIsProceeding] = useState(false);
	const [showAllSources, setShowAllSources] = useState(false);

	const hasSummary = Boolean(summary && summary.trim().length > 0);
	const summaryLines =
		hasSummary && summary
			? summary.split("\n").filter((line) => line.trim().length > 0)
			: [];

	const visibleSources = showAllSources ? sources : sources.slice(0, 4);
	const hasSources = sources.length > 0;

	const getSourceLabel = (url: string) => {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	};

	useEffect(() => {
		resetStreaming();
	}, [resetStreaming]);

	useEffect(() => {
		if (!prompt || !slideCount) {
			navigate(ROUTES.generate);
		}
	}, [navigate, prompt, slideCount]);

	useEffect(() => {
		const controller = new AbortController();

		const fetchResearch = async () => {
			if (!prompt || !slideCount) return;

			setLoading(true);
			setError("");
			setShowAllSources(false);
			setTokensUsed(null);
			setTokensEstimated(null);

			try {
				const response = await fetch(`${API_URL}/api/research-presentation`, {
					method: "POST",
					credentials: "include",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						topic: prompt,
						research: {
							enabled: true,
						},
					}),
					signal: controller.signal,
				});

				if (!response.ok) {
					const errorData = await response.json();
					const errorMessage =
						typeof errorData.error === "string"
							? errorData.error
							: errorData.error?.message ||
								errorData.message ||
								"Failed to fetch research";
					setError(errorMessage);
					setLoading(false);
					return;
				}

				const data = (await response.json()) as ResearchPayload & {
					tokens_used?: number;
					tokens_estimated?: number;
				};
				setSummary(typeof data.summary === "string" ? data.summary : null);
				setSources(Array.isArray(data.sources) ? data.sources : []);
				setTokensUsed(
					typeof data.tokens_used === "number" ? data.tokens_used : null,
				);
				setTokensEstimated(
					typeof data.tokens_estimated === "number"
						? data.tokens_estimated
						: null,
				);
			} catch (err: unknown) {
				if (err instanceof Error && err.name === "AbortError") return;
				const message = err instanceof Error ? err.message : String(err);
				setError(message);
			} finally {
				setLoading(false);
			}
		};

		fetchResearch();
		return () => controller.abort();
	}, [prompt, slideCount]);

	useEffect(() => {
		if (isProceeding && streamingState.slides.length >= 1) {
			navigate(ROUTES.presentation, { state: { isStreaming: true } });
		}
	}, [isProceeding, navigate, streamingState.slides.length]);

	const handleProceed = async () => {
		if (!prompt || !slideCount) return;

		setIsProceeding(true);
		setError("");

		const payload: ResearchPayload = {
			summary,
			sources,
		};

		const success = await startStreaming(
			prompt,
			slideCount,
			detailLevel,
			tonality,
			false,
			payload,
		);

		if (!success) {
			setIsProceeding(false);
		}
	};

	return (
		<div className="h-screen overflow-hidden bg-transparent flex flex-col">
			<Header />
			<div className="flex-1 overflow-y-auto relative">
				{/* Back Button */}
				<button
					type="button"
					onClick={() => navigate(-1)}
					className="absolute top-8 left-8 p-3 rounded-full hover:bg-white/5 text-white/40 hover:text-white transition-all duration-300 group z-10"
					aria-label="Go back"
				>
					<ArrowLeft className="w-6 h-6 transform group-hover:-translate-x-1 transition-transform" />
				</button>

				<div className="w-full max-w-4xl mx-auto py-16 px-6">
					<div className="space-y-16">
						{/* Header Section */}
						<div className="text-center space-y-4">
							<h2 className="text-4xl md:text-5xl font-light text-white tracking-wide">
								Research Insights
							</h2>
						</div>

						{/* Error State */}
						{error && (
							<div className="bg-red-500/10 border border-red-500/20 text-red-200 px-8 py-6 rounded-2xl backdrop-blur-sm text-center font-light text-lg">
								{error}
							</div>
						)}

						{/* Main Content Grid */}
						<div className="grid gap-8">
							{/* Summary Section */}
							<div className="bg-black/20 backdrop-blur-xl rounded-3xl p-8 md:p-12 border border-white/5 space-y-8">
								<div className="flex items-center justify-between border-b border-white/5 pb-6">
									<h3 className="text-2xl font-light text-white/90 flex items-center gap-3">
										Synopsis
										{loading && (
											<Loader2 className="h-5 w-5 animate-spin text-white/40" />
										)}
									</h3>
								</div>

								{(tokensUsed !== null || tokensEstimated !== null) && (
									<p className="text-sm font-light text-white/40">
										Search tokens: {tokensUsed !== null ? tokensUsed : "?"} used{" "}
										/ {tokensEstimated !== null ? tokensEstimated : "?"} est
									</p>
								)}

								{hasSummary ? (
									<div className="space-y-6 text-lg font-light leading-relaxed text-white/80">
										{summaryLines.map((line) => (
											<p key={line}>{line}</p>
										))}
									</div>
								) : (
									<div className="text-lg font-light text-white/40 italic">
										{loading
											? "Synthesizing research data..."
											: "No summary available."}
									</div>
								)}
							</div>

							{/* Sources Grid */}
							<div className="space-y-6">
								<div className="flex items-center justify-between">
									<h3 className="text-2xl font-light text-white/90">Sources</h3>
									{sources.length > 4 && (
										<button
											type="button"
											onClick={() => setShowAllSources((prev) => !prev)}
											className="text-sm text-white/50 hover:text-white/80 transition-colors"
										>
											{showAllSources
												? "Show less"
												: `Show all (${sources.length})`}
										</button>
									)}
								</div>

								<div className="grid md:grid-cols-2 gap-6">
									{hasSources &&
										visibleSources.map((source) => (
											<a
												key={source.url}
												href={source.url}
												target="_blank"
												rel="noopener noreferrer"
												className="group bg-black/20 hover:bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-all duration-300"
											>
												<h4 className="text-lg font-light text-white/90 mb-2 line-clamp-1 group-hover:text-white transition-colors">
													{source.title || getSourceLabel(source.url)}
												</h4>
												<p className="text-sm text-white/50 font-light line-clamp-2 mb-4">
													{source.snippet ||
														"No preview available for this source."}
												</p>
												<p className="text-xs text-white/30 truncate">
													{source.url}
												</p>
											</a>
										))}

									{!loading && !hasSources && (
										<div className="md:col-span-2 bg-black/10 rounded-2xl p-6 border border-white/5 text-center text-white/40 font-light">
											No sources found. Try a different phrasing or a broader
											topic.
										</div>
									)}

									{loading &&
										sources.length === 0 &&
										[1, 2].map((i) => (
											<div
												key={i}
												className="bg-black/10 rounded-2xl p-6 border border-white/5 animate-pulse"
											>
												<div className="h-6 w-3/4 bg-white/5 rounded mb-4" />
												<div className="h-4 w-full bg-white/5 rounded mb-2" />
												<div className="h-4 w-2/3 bg-white/5 rounded" />
											</div>
										))}
								</div>
							</div>
						</div>

						{/* Action Area */}
						<div className="flex justify-center pt-8 pb-16">
							<Button
								onClick={handleProceed}
								disabled={loading || isProceeding || Boolean(error)}
								className="relative group overflow-hidden px-12 py-9 bg-white/10 hover:bg-white/15 backdrop-blur-md rounded-full border border-white/20 text-white transition-all duration-300 hover:border-white/40 hover:shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<span className="relative flex items-center gap-4 text-xl font-light tracking-wide">
									{isProceeding ? (
										<>
											<Loader2 className="h-6 w-6 animate-spin" />
											Processing...
										</>
									) : (
										<>
											<Sparkles className="h-6 w-6 opacity-70 group-hover:opacity-100 transition-opacity" />
											Proceed to Generate
										</>
									)}
								</span>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
