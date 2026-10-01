import { IMAGE_LAYOUTS, LAYOUTS, type LayoutId } from "@slidesage/cards";
import type {
	AIModelSelection,
	ApiErrorResponse,
	Outline,
	OutlineEntry,
	OutlineResponse,
	ResearchPayload,
} from "@slidesage/types";
import { useStreaming } from "@slidesage/ui";
import { Button } from "@slidesage/ui/components/button";
import { LAYOUT_NAMES } from "@slidesage/ui/components/Cards";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { Input } from "@slidesage/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@slidesage/ui/components/select";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { API_URL } from "@slidesage/ui/lib/api";
import { publishPointsBalance } from "@slidesage/ui/lib/points";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";

interface OutlineRouteState {
	prompt: string;
	slideCount: number;
	detailLevel: string;
	tonality: string;
	researchPayload?: ResearchPayload;
	retryPresentationId?: string;
	ai?: AIModelSelection;
}

const MAX_CARDS = 40;

function isImageLayout(layout: string): boolean {
	return (IMAGE_LAYOUTS as readonly string[]).includes(layout);
}

function outlineProblem(outline: Outline): string | null {
	if (!outline.title.trim()) return "Give the presentation a title.";
	const blank = outline.cards.findIndex((entry) => !entry.takeaway.trim());
	if (blank !== -1) return `Card ${blank + 1} needs a point.`;
	const photoless = outline.cards.findIndex(
		(entry) => isImageLayout(entry.layout) && !entry.imageQuery?.trim(),
	);
	if (photoless !== -1) return `Card ${photoless + 1} needs a photo search.`;
	return null;
}

/**
 * The plan for a deck, before any card is written. The user can reword
 * points, reorder or remove cards, and choose layouts; drafting then follows
 * the approved outline exactly.
 */
export default function OutlinePage() {
	const location = useLocation();
	const navigate = useNavigate();
	const request = location.state as OutlineRouteState | null;
	const { streamingState, generate } = useStreaming();
	const [outline, setOutline] = useState<Outline | null>(null);
	const [photos, setPhotos] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const requested = useRef(false);
	const submitted = useRef(false);

	useEffect(() => {
		if (!request?.prompt) navigate(ROUTES.generate, { replace: true });
	}, [navigate, request]);

	// One outline per visit: the request is paid for, so a re-render or a
	// strict-mode double effect must not ask twice.
	useEffect(() => {
		if (!request?.prompt || requested.current) return;
		requested.current = true;
		void (async () => {
			try {
				const response = await fetch(`${API_URL}/presentation-outlines`, {
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						outline_id: crypto.randomUUID(),
						topic: request.prompt,
						slide_count: request.slideCount,
						detail_level: request.detailLevel,
						tonality: request.tonality,
						research: { enabled: Boolean(request.researchPayload) },
						research_payload: request.researchPayload,
						ai: request.ai,
					}),
				});
				const body = (await response.json().catch(() => null)) as
					| (Partial<OutlineResponse> & Partial<ApiErrorResponse>)
					| null;
				if (!response.ok || !body?.plan) {
					setError(body?.error?.message ?? "The outline could not be prepared.");
					setLoadFailed(true);
					return;
				}
				publishPointsBalance(body.slide_tokens_remaining);
				setPhotos(Boolean(body.photos));
				setOutline(body.plan);
			} catch {
				setError("The outline could not be prepared. Check your connection.");
				setLoadFailed(true);
			}
		})();
	}, [request]);

	// Once the job is accepted, the presentation page shows the cards arriving.
	useEffect(() => {
		if (submitted.current && streamingState.accepted && streamingState.presentationId) {
			submitted.current = false;
			navigate(ROUTES.presentationById(streamingState.presentationId));
		}
	}, [navigate, streamingState.accepted, streamingState.presentationId]);

	useEffect(() => {
		if (streamingState.error) {
			setError(streamingState.error);
			setSubmitting(false);
		}
	}, [streamingState.error]);

	const update = (index: number, patch: Partial<OutlineEntry>) =>
		setOutline((current) =>
			current
				? {
						...current,
						cards: current.cards.map((entry, at) =>
							at === index ? { ...entry, ...patch } : entry,
						),
					}
				: current,
		);

	const move = (index: number, offset: number) =>
		setOutline((current) => {
			if (!current) return current;
			const target = index + offset;
			if (target < 0 || target >= current.cards.length) return current;
			const cards = [...current.cards];
			const [entry] = cards.splice(index, 1);
			if (entry) cards.splice(target, 0, entry);
			return { ...current, cards };
		});

	const remove = (index: number) =>
		setOutline((current) =>
			current && current.cards.length > 1
				? { ...current, cards: current.cards.filter((_, at) => at !== index) }
				: current,
		);

	const add = () =>
		setOutline((current) =>
			current && current.cards.length < MAX_CARDS
				? {
						...current,
						cards: [
							...current.cards,
							{
								position: current.cards.length + 1,
								takeaway: "",
								role: "insight",
								layout: "statement",
							},
						],
					}
				: current,
		);

	const problem = outline ? outlineProblem(outline) : null;

	const draft = async () => {
		if (!outline || !request || problem || submitting) return;
		setSubmitting(true);
		setError(null);
		submitted.current = true;
		const plan: Outline = {
			title: outline.title.trim(),
			cards: outline.cards.map((entry, index) => ({
				...entry,
				position: index + 1,
				takeaway: entry.takeaway.trim(),
				imageQuery: isImageLayout(entry.layout) ? entry.imageQuery?.trim() : undefined,
			})),
		};
		const accepted = await generate({
			prompt: request.prompt,
			slideCount: plan.cards.length,
			detailLevel: request.detailLevel,
			tonality: request.tonality,
			researchEnabled: Boolean(request.researchPayload),
			researchPayload: request.researchPayload,
			retryPresentationId: request.retryPresentationId,
			ai: request.ai,
			plan,
		});
		if (!accepted) {
			submitted.current = false;
			setSubmitting(false);
		}
	};

	const layouts = LAYOUTS.filter((layout) => photos || !isImageLayout(layout));

	return (
		<div className="flex min-h-dvh w-full flex-col bg-transparent">
			<Header />
			<FloatingNotice error={error} onDismiss={() => setError(null)} />
			<main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 md:px-8">
				{!outline && !loadFailed && (
					<section
						className="flex flex-1 flex-col items-center justify-center gap-4"
						aria-live="polite"
					>
						<ThinkingOrb size={64} />
						<p className="text-sm text-white/70">Planning your presentation</p>
					</section>
				)}
				{loadFailed && !outline && (
					<section className="flex flex-1 flex-col items-center justify-center gap-4" role="alert">
						<p className="text-sm text-white/70">The outline could not be prepared.</p>
						<Button variant="ghost" onClick={() => navigate(ROUTES.generate)}>
							Back to generate
						</Button>
					</section>
				)}
				{outline && (
					<>
						<div className="flex flex-col gap-2">
							<p className="text-sm text-white/50">Review the outline, then write the cards.</p>
							<Input
								aria-label="Presentation title"
								value={outline.title}
								maxLength={120}
								onChange={(event) => setOutline({ ...outline, title: event.target.value })}
								className="h-11 border-white/10 bg-transparent text-xl font-semibold text-white"
							/>
						</div>
						<ol aria-label="Outline" className="flex flex-col divide-y divide-white/10">
							{outline.cards.map((entry, index) => (
								<li key={`${index}-${entry.position}`} className="flex gap-3 py-4">
									<span className="w-6 shrink-0 pt-2 text-sm text-white/40 tabular-nums">
										{index + 1}
									</span>
									<div className="flex min-w-0 flex-1 flex-col gap-2">
										<Input
											aria-label={`Card ${index + 1} point`}
											value={entry.takeaway}
											maxLength={200}
											placeholder="The one point this card makes"
											onChange={(event) => update(index, { takeaway: event.target.value })}
											className="border-white/10 bg-transparent text-white"
										/>
										<div className="flex flex-wrap items-center gap-2">
											<Select
												value={entry.layout}
												onValueChange={(layout) =>
													update(index, {
														layout,
														imageQuery:
															isImageLayout(layout) && !entry.imageQuery
																? entry.takeaway.slice(0, 100)
																: entry.imageQuery,
													})
												}
											>
												<SelectTrigger
													aria-label={`Card ${index + 1} layout`}
													className="h-8 w-40 border-white/10 bg-transparent text-xs text-white/70"
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{layouts.map((layout) => (
														<SelectItem key={layout} value={layout}>
															{LAYOUT_NAMES[layout as LayoutId]}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											{isImageLayout(entry.layout) && (
												<Input
													aria-label={`Card ${index + 1} photo search`}
													value={entry.imageQuery ?? ""}
													maxLength={100}
													placeholder="Photo search"
													onChange={(event) => update(index, { imageQuery: event.target.value })}
													className="h-8 min-w-0 flex-1 border-white/10 bg-transparent text-xs text-white/80"
												/>
											)}
										</div>
									</div>
									<div className="flex shrink-0 items-start gap-1">
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Move card ${index + 1} up`}
											disabled={index === 0}
											onClick={() => move(index, -1)}
											className="size-8 text-white/60 hover:bg-white/10 hover:text-white"
										>
											<ArrowUp className="size-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Move card ${index + 1} down`}
											disabled={index === outline.cards.length - 1}
											onClick={() => move(index, 1)}
											className="size-8 text-white/60 hover:bg-white/10 hover:text-white"
										>
											<ArrowDown className="size-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Remove card ${index + 1}`}
											disabled={outline.cards.length <= 1}
											onClick={() => remove(index)}
											className="size-8 text-white/60 hover:bg-white/10 hover:text-white"
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								</li>
							))}
						</ol>
						<div className="flex flex-wrap items-center gap-3">
							<Button
								variant="ghost"
								onClick={add}
								disabled={outline.cards.length >= MAX_CARDS}
								className="gap-2 text-white/70 hover:bg-white/10 hover:text-white"
							>
								<Plus className="size-4" />
								Add card
							</Button>
							<span className="ml-auto text-sm text-amber-200/80" role="status">
								{problem}
							</span>
							<Button
								onClick={() => void draft()}
								disabled={!!problem || submitting}
								className="h-10 border border-white/20 bg-white/10 px-5 text-white hover:bg-white/15 disabled:opacity-50"
							>
								{submitting ? "Starting" : `Write ${outline.cards.length} cards`}
							</Button>
						</div>
					</>
				)}
			</main>
		</div>
	);
}
