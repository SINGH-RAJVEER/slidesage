import type { AIModelSelection, ResearchPayload } from "@slidesage/types";
import { useStreaming } from "@slidesage/ui";
import { Button } from "@slidesage/ui/components/button";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { ArrowLeft, ExternalLink, RefreshCw, Sparkles, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";

interface ResearchRouteState {
	prompt: string;
	slideCount: number;
	detailLevel: string;
	tonality: string;
	researchPayload?: ResearchPayload;
	retryPresentationId?: string;
	ai?: AIModelSelection;
	/** The theme of the template chosen on the generate page. */
	theme?: string;
}

type ResearchStatus = "loading" | "ready" | "error";

export default function GenerateResearchPage() {
	const location = useLocation();
	const navigate = useNavigate();
	const {
		streamingState,
		researchPreviewState,
		previewResearch,
		removeResearchSource,
		restoreResearchSources,
	} = useStreaming();

	const routeState = location.state as ResearchRouteState | null;
	const prompt = routeState?.prompt?.trim() ?? "";
	const slideCount = routeState?.slideCount ?? 0;
	const detailLevel = routeState?.detailLevel ?? "balanced";
	const tonality = routeState?.tonality ?? "professional";
	const savedResearch = routeState?.researchPayload;
	const retryPresentationId = routeState?.retryPresentationId;
	const ai = routeState?.ai;
	const theme = routeState?.theme;

	const [isProceeding, setIsProceeding] = useState(false);
	const [researchAttempt, setResearchAttempt] = useState(0);
	const isProceedingRef = useRef(false);
	const removeButtonsRef = useRef(new Map<string, HTMLButtonElement>());
	const restoreButtonRef = useRef<HTMLButtonElement>(null);

	const researchRequest = useMemo(
		() => ({
			prompt,
			slideCount,
			detailLevel,
			tonality,
		}),
		[detailLevel, prompt, slideCount, tonality],
	);
	const fetchedSources = researchPreviewState.sources;
	const removedSourceUrls = researchPreviewState.removedSourceUrls;
	const sources = useMemo(
		() => fetchedSources.filter((source) => !removedSourceUrls.includes(source.url)),
		[fetchedSources, removedSourceUrls],
	);
	const removedCount = fetchedSources.length - sources.length;
	const estimatedTokens = researchPreviewState.estimatedTokens;
	const error = researchPreviewState.error ?? "";
	const researchStatus: ResearchStatus =
		researchPreviewState.status === "ready"
			? "ready"
			: researchPreviewState.status === "error"
				? "error"
				: "loading";

	const hasSources = sources.length > 0;
	const isLoading = researchStatus === "loading";

	const getSourceLabel = (url: string) => {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	};

	useEffect(() => {
		if (!prompt || !slideCount) {
			navigate(ROUTES.generate);
		}
	}, [navigate, prompt, slideCount]);

	useEffect(() => {
		if (!prompt || !slideCount) return;
		void previewResearch(researchRequest, savedResearch, researchAttempt > 0);
	}, [prompt, slideCount, researchAttempt, researchRequest, savedResearch, previewResearch]);

	// The removed row takes its focused button with it, so focus moves to the
	// neighbouring row, or to the restore button once no rows are left.
	const handleRemoveSource = (url: string) => {
		const index = sources.findIndex((source) => source.url === url);
		const nextUrl = (sources[index + 1] ?? sources[index - 1])?.url;
		flushSync(() => removeResearchSource(url));
		((nextUrl && removeButtonsRef.current.get(nextUrl)) || restoreButtonRef.current)?.focus();
	};

	// The restore button unmounts once nothing is removed, so focus moves to the
	// first row rather than falling to the page, where Enter would proceed.
	const handleRestoreSources = () => {
		flushSync(restoreResearchSources);
		const firstUrl = fetchedSources[0]?.url;
		if (firstUrl) removeButtonsRef.current.get(firstUrl)?.focus();
	};

	const handleProceed = useCallback(async () => {
		if (
			!prompt ||
			!slideCount ||
			researchStatus !== "ready" ||
			streamingState.isStreaming ||
			isProceedingRef.current
		) {
			return;
		}

		isProceedingRef.current = true;
		setIsProceeding(true);

		const payload: ResearchPayload = {
			sources,
			...(estimatedTokens === null ? {} : { estimated_tokens: estimatedTokens }),
		};

		navigate(ROUTES.outline, {
			state: {
				prompt,
				slideCount,
				detailLevel,
				tonality,
				researchPayload: payload,
				retryPresentationId,
				...(ai ? { ai } : {}),
				...(theme ? { theme } : {}),
			},
		});
	}, [
		navigate,
		theme,
		detailLevel,
		estimatedTokens,
		ai,
		prompt,
		researchStatus,
		retryPresentationId,
		slideCount,
		sources,
		streamingState.isStreaming,
		tonality,
	]);

	// Assigned during render so the listener below always reaches the current
	// handler. Registering the handler itself leaves a window where research has
	// become ready on screen but the listener still holds the closure that
	// refuses to proceed, and an Enter pressed in that window is dropped for
	// good.
	const proceedRef = useRef(handleProceed);
	proceedRef.current = handleProceed;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.key !== "Enter" ||
				event.repeat ||
				event.shiftKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey
			) {
				return;
			}

			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable || target.closest("a, button, input, textarea, select") !== null)
			) {
				return;
			}

			event.preventDefault();
			void proceedRef.current();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-transparent">
			<Header />
			<div className="relative min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
				<button
					type="button"
					onClick={() => navigate(-1)}
					className="absolute left-4 top-4 z-10 rounded-md p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white md:left-8 md:top-8"
					aria-label="Go back"
				>
					<ArrowLeft className="h-5 w-5" />
				</button>

				<div className="mx-auto w-full max-w-7xl px-4 py-10 md:px-8 lg:px-12">
					<div className="space-y-8">
						<div className="text-center">
							<h2 className="text-3xl font-semibold text-white md:text-4xl">Research Insights</h2>
						</div>

						{researchStatus === "error" && (
							<div className="flex flex-col items-center gap-4 rounded-lg border border-red-500/20 bg-red-500/10 px-6 py-5 text-center text-red-200">
								<p>{error}</p>
								<Button
									type="button"
									onClick={() => setResearchAttempt((attempt) => attempt + 1)}
									className="h-10 rounded-md border border-red-200/20 bg-transparent px-4 text-red-100 hover:bg-red-200/10"
								>
									<RefreshCw className="h-4 w-4" />
									Retry research
								</Button>
							</div>
						)}

						<div className="space-y-6">
							<div className="flex items-center justify-between">
								<h3 className="flex items-center gap-2 text-xl font-semibold text-white/90">
									Sources
									{isLoading && <ThinkingOrb size={20} className="opacity-50" />}
								</h3>
								<div className="flex items-center gap-3">
									{removedCount > 0 && (
										<Button
											ref={restoreButtonRef}
											type="button"
											variant="ghost"
											size="sm"
											onClick={handleRestoreSources}
											className="text-white/60 hover:bg-white/10 hover:text-white"
										>
											<Undo2 className="h-4 w-4" />
											Restore {removedCount} removed
										</Button>
									)}
									{hasSources && (
										<span className="text-sm text-white/45">
											{sources.length} {sources.length === 1 ? "source" : "sources"}
										</span>
									)}
								</div>
							</div>

							<div className="max-h-[62dvh] overflow-auto rounded-md border border-white/10 bg-black/15">
								<table
									className="w-full min-w-full table-fixed text-left md:min-w-[880px]"
									aria-label="Research sources"
								>
									<colgroup>
										<col className="w-auto md:w-[28%]" />
										<col className="hidden md:table-column md:w-[44%]" />
										<col className="hidden md:table-column md:w-[17%]" />
										<col className="w-24 md:w-[11%]" />
									</colgroup>
									<thead className="sticky top-0 z-20 bg-[hsl(222,27%,12%)]">
										<tr className="border-b border-white/10 bg-white/[0.025]">
											<th
												scope="col"
												className="sticky top-0 bg-[hsl(222,27%,12%)] px-4 py-3 text-xs font-medium text-white/45"
											>
												Source
											</th>
											<th
												scope="col"
												className="sticky top-0 hidden bg-[hsl(222,27%,12%)] px-4 py-3 text-xs font-medium text-white/45 md:table-cell"
											>
												Research note
											</th>
											<th
												scope="col"
												className="sticky top-0 hidden bg-[hsl(222,27%,12%)] px-4 py-3 text-xs font-medium text-white/45 md:table-cell"
											>
												Details
											</th>
											<th
												scope="col"
												className="sticky right-0 top-0 bg-[hsl(222,27%,12%)] px-3 py-3"
											>
												<span className="sr-only">Source actions</span>
											</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-white/[0.07]">
										{hasSources &&
											sources.map((source) => {
												const sourceTitle = source.title || getSourceLabel(source.url);

												return (
													<tr
														key={source.url}
														className="group/row transition-colors hover:bg-white/[0.035]"
													>
														<td className="px-5 py-5 align-top">
															<p className="break-words text-sm font-medium leading-5 text-white/90">
																{sourceTitle}
															</p>
															<p className="mt-1 truncate text-xs text-white/35">
																{getSourceLabel(source.url)}
															</p>
															<p className="mt-3 line-clamp-4 whitespace-pre-line text-sm leading-6 text-white/60 md:hidden">
																{source.summary ||
																	source.snippet ||
																	"No preview available for this source."}
															</p>
														</td>
														<td className="hidden px-5 py-5 align-top md:table-cell">
															<p className="line-clamp-4 whitespace-pre-line text-sm leading-6 text-white/60">
																{source.summary ||
																	source.snippet ||
																	"No preview available for this source."}
															</p>
														</td>
														<td className="hidden px-5 py-5 align-top text-xs leading-5 text-white/45 md:table-cell">
															{source.author || source.published_date ? (
																<div className="space-y-0.5">
																	{source.author && (
																		<p className="truncate text-white/60">{source.author}</p>
																	)}
																	{source.published_date && <p>{source.published_date}</p>}
																</div>
															) : (
																<span className="text-white/30">Not listed</span>
															)}
														</td>
														<td className="sticky right-0 bg-background/95 px-3 py-5 text-center align-top transition-colors group-hover/row:bg-[#121214]">
															<div className="inline-flex gap-2">
																<a
																	href={source.url}
																	target="_blank"
																	rel="noopener noreferrer"
																	aria-label={`Open source: ${sourceTitle}`}
																	title="Open source"
																	className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/45 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
																>
																	<ExternalLink className="h-4 w-4" />
																</a>
																<Button
																	ref={(button) => {
																		if (button) {
																			removeButtonsRef.current.set(source.url, button);
																		} else {
																			removeButtonsRef.current.delete(source.url);
																		}
																	}}
																	type="button"
																	variant="ghost"
																	size="icon"
																	onClick={() => handleRemoveSource(source.url)}
																	aria-label={`Remove source: ${sourceTitle}`}
																	title="Remove source"
																	className="size-8 border border-white/10 text-white/45 hover:border-red-300/30 hover:bg-red-400/10 hover:text-red-200"
																>
																	<X className="h-4 w-4" />
																</Button>
															</div>
														</td>
													</tr>
												);
											})}

										{researchStatus === "ready" && !hasSources && (
											<tr>
												<td colSpan={4} className="px-6 py-10 text-center text-sm text-white/45">
													{removedCount > 0
														? "All sources removed. Restore them, or proceed without research sources."
														: "No sources found. Try a different phrasing or a broader topic."}
												</td>
											</tr>
										)}

										{isLoading &&
											sources.length === 0 &&
											[1, 2, 3, 4].map((i) => (
												<tr key={i} className="animate-pulse">
													<td className="px-4 py-5">
														<div className="mb-2 h-4 w-4/5 rounded bg-white/5" />
														<div className="h-3 w-2/5 rounded bg-white/5" />
													</td>
													<td className="hidden px-4 py-5 md:table-cell">
														<div className="mb-2 h-3 w-full rounded bg-white/5" />
														<div className="h-3 w-3/4 rounded bg-white/5" />
													</td>
													<td className="hidden px-4 py-5 md:table-cell">
														<div className="h-3 w-2/3 rounded bg-white/5" />
													</td>
													<td className="sticky right-0 bg-background/95 px-3 py-5">
														<div className="mx-auto h-8 w-8 rounded-md bg-white/5" />
													</td>
												</tr>
											))}
									</tbody>
								</table>
							</div>
						</div>

						<div className="flex flex-col items-center gap-4 pb-6 pt-2">
							<Button
								onClick={handleProceed}
								disabled={researchStatus !== "ready" || isProceeding || streamingState.isStreaming}
								className="group h-11 rounded-md border border-white/20 bg-white/10 px-6 text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<span className="flex items-center gap-2 text-sm font-semibold">
									{isProceeding ? (
										<>
											<ThinkingOrb size={20} />
											Processing...
										</>
									) : (
										<>
											<Sparkles className="h-4 w-4 opacity-80" />
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
