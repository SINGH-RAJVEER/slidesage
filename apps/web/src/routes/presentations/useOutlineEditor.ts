import { IMAGE_LAYOUTS, LAYOUTS } from "@slidesage/cards";
import type {
	AIModelSelection,
	ApiErrorResponse,
	Outline,
	OutlineEntry,
	OutlineResponse,
	PresentationRetryOptions,
	ResearchPayload,
} from "@slidesage/types";
import { useAuth, useStreaming } from "@slidesage/ui";
import { API_URL } from "@slidesage/ui/lib/api";
import { publishPointsBalance } from "@slidesage/ui/lib/points";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "../../app/router/paths";
import {
	isRecord,
	pageDraftKey,
	readPageDraft,
	usePageDraft,
	writePageDraft,
} from "../../hooks/usePageDraft";
import { type GenerateDraft, isGenerateDraft } from "./generate-draft";

export interface OutlineRouteState {
	prompt: string;
	slideCount: number;
	detailLevel: string;
	tonality: string;
	researchPayload?: ResearchPayload;
	retryPresentationId?: string;
	ai?: AIModelSelection;
	/** The theme of the template chosen on the generate page. */
	theme?: string;
	/** An outline approved before a failed attempt, reused instead of planning again. */
	plan?: Outline;
}

export const MAX_CARDS = 40;

interface OutlineDraft {
	request: OutlineRouteState | null;
	outline: Outline | null;
	photos: boolean;
}

function isOutlineDraft(value: unknown): value is OutlineDraft {
	return (
		isRecord(value) &&
		typeof value["photos"] === "boolean" &&
		(value["request"] === null ||
			(isRecord(value["request"]) &&
				typeof value["request"]["prompt"] === "string" &&
				typeof value["request"]["slideCount"] === "number" &&
				typeof value["request"]["detailLevel"] === "string" &&
				typeof value["request"]["tonality"] === "string")) &&
		(value["outline"] === null ||
			(isRecord(value["outline"]) &&
				typeof value["outline"]["title"] === "string" &&
				Array.isArray(value["outline"]["cards"]) &&
				value["outline"]["cards"].length > 0 &&
				value["outline"]["cards"].length <= MAX_CARDS &&
				value["outline"]["cards"].every(
					(card) =>
						isRecord(card) &&
						typeof card["position"] === "number" &&
						typeof card["takeaway"] === "string" &&
						typeof card["role"] === "string" &&
						typeof card["layout"] === "string",
				)))
	);
}

export function isImageLayout(layout: string): boolean {
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

/** Points errors offer the purchase page, where points can be bought or earned from ads. */
export function needsPoints(message: string | null): boolean {
	return message !== null && /insufficient points/i.test(message);
}

/** The outline's state and actions, shared by whichever view presents them. */
export function useOutlineEditor() {
	const location = useLocation();
	const navigate = useNavigate();
	const { user } = useAuth();
	const routeRequest = location.state as OutlineRouteState | null;
	const [draftState, setDraftState] = usePageDraft<OutlineDraft>(
		"outline",
		{
			request: routeRequest,
			outline: routeRequest?.plan ?? null,
			// A saved outline has no planning response to say whether photos are
			// available; one that already chose a photo layout had them.
			photos: Boolean(routeRequest?.plan?.cards.some((entry) => isImageLayout(entry.layout))),
		},
		isOutlineDraft,
		routeRequest ? location.key : undefined,
	);
	const { request, outline, photos } = draftState;
	const setOutline = (action: Outline | null | ((outline: Outline | null) => Outline | null)) =>
		setDraftState((current) => ({
			...current,
			outline: typeof action === "function" ? action(current.outline) : action,
		}));
	const { streamingState, generate } = useStreaming();
	const [error, setError] = useState<string | null>(null);
	// Why the outline could not be prepared. It replaces the outline, so it
	// stays on the page rather than in the transient notice.
	const [loadError, setLoadError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const requested = useRef(false);
	const submitted = useRef(false);
	const completed = useRef(false);

	useEffect(() => {
		if (!request?.prompt && !completed.current) navigate(ROUTES.generate, { replace: true });
	}, [navigate, request]);

	// Reuse a saved or retried outline. Planning is paid for, so restoring edits
	// must not make another request or charge the user again.
	useEffect(() => {
		if (!request?.prompt || outline || requested.current) return;
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
					(Partial<OutlineResponse> & Partial<ApiErrorResponse>) | null;
				if (!response.ok || !body?.plan) {
					setLoadError(body?.error?.message ?? "The outline could not be prepared.");
					return;
				}
				publishPointsBalance(body.slide_tokens_remaining);
				setDraftState((current) => ({
					...current,
					photos: Boolean(body.photos),
					outline: body.plan as Outline,
				}));
			} catch {
				setLoadError("The outline could not be prepared. Check your connection.");
			}
		})();
	}, [outline, request, setDraftState]);

	// Once the job is accepted, the presentation page shows the cards arriving.
	useEffect(() => {
		if (submitted.current && streamingState.accepted && streamingState.presentationId) {
			submitted.current = false;
			completed.current = true;
			setDraftState({ request: null, outline: null, photos: false });
			const key = pageDraftKey(user?.id, "generate");
			const setup = readPageDraft(
				key,
				(value): value is { value: GenerateDraft; seedKey?: string; owner?: string } =>
					isRecord(value) && isGenerateDraft(value["value"]),
			);
			if (
				setup &&
				setup.value.retryPresentationId === request?.retryPresentationId &&
				setup.value.prompt.trim() === request?.prompt.trim()
			) {
				writePageDraft(key, {
					...setup,
					value: { ...setup.value, retry: undefined, retryPresentationId: undefined },
				});
			}
			navigate(ROUTES.presentationById(streamingState.presentationId));
		}
	}, [
		navigate,
		request,
		setDraftState,
		streamingState.accepted,
		streamingState.presentationId,
		user?.id,
	]);

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

	// Leaving a failed outline keeps what the user chose. Reviewed sources go
	// back to the research page, which shows them without another paid search;
	// otherwise the generate form is refilled the way a saved retry refills it.
	const back = () => {
		if (!request) return;
		// A paid outline travels with the user, so returning unchanged does not plan again.
		const plan = outline ? { plan: outline } : {};
		if (request.researchPayload) {
			navigate(ROUTES.research, { state: { ...request, ...plan } });
			return;
		}
		const retry: PresentationRetryOptions = {
			prompt: request.prompt,
			slide_count: outline?.cards.length ?? request.slideCount,
			detail_level: request.detailLevel,
			tonality: request.tonality,
			research_enabled: false,
			...(request.ai ? { ai: request.ai } : {}),
			...(request.theme ? { theme: request.theme } : {}),
			...plan,
		};
		navigate(ROUTES.generate, {
			state: { retry, retryPresentationId: request.retryPresentationId },
		});
	};

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
			theme: request.theme,
			plan,
		});
		if (!accepted) {
			submitted.current = false;
			setSubmitting(false);
		}
	};

	const setLayout = (index: number, layout: string) =>
		setOutline((current) =>
			current
				? {
						...current,
						cards: current.cards.map((entry, at) =>
							at === index
								? {
										...entry,
										layout,
										imageQuery:
											isImageLayout(layout) && !entry.imageQuery
												? entry.takeaway.slice(0, 100)
												: entry.imageQuery,
									}
								: entry,
						),
					}
				: current,
		);

	const layouts = LAYOUTS.filter((layout) => photos || !isImageLayout(layout));

	return {
		add,
		back,
		draft,
		error,
		layouts,
		loadError,
		move,
		navigate,
		outline,
		problem,
		remove,
		request,
		setError,
		setLayout,
		setOutline,
		submitting,
		update,
	};
}

export type OutlineEditor = ReturnType<typeof useOutlineEditor>;
