import { CARD_TEMPLATES, getCardTemplate } from "@slidesage/cards";
import type { PresentationRetryOptions } from "@slidesage/types";
import { useStreaming } from "@slidesage/ui";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import {
	DEFAULT_RESEARCH_RESULTS,
	GenerateForm,
	GenerateOptionsBar,
} from "@slidesage/ui/components/Generate";
import { useDebouncedCallback } from "@tanstack/react-pacer/debouncer";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { useHorizonPageReady } from "../../app/transitions/HorizonTransition";
import { usePageDraft } from "../../hooks/usePageDraft";
import { useTemplateLibrary } from "../marketplace/template-library";
import { type GenerateDraft, isGenerateDraft } from "./generate-draft";

interface GenerateRouteState {
	retry?: PresentationRetryOptions;
	retryPresentationId?: string;
}

function retrySlideCount(retry: PresentationRetryOptions): number {
	return Math.min(40, Math.max(5, retry.slide_count));
}

export default function GeneratePPTPage() {
	useHorizonPageReady();
	const location = useLocation();
	const routeState = location.state as GenerateRouteState | null;
	// Unknown retry themes leave the selection empty instead of substituting another template.
	const [draft, setDraft] = usePageDraft<GenerateDraft>(
		"generate",
		{
			prompt: routeState?.retry?.prompt.trim() ?? "",
			slideCount: (routeState?.retry ? retrySlideCount(routeState.retry) : 5).toString(),
			detailLevel: routeState?.retry?.detail_level ?? "balanced",
			tonality: routeState?.retry?.tonality ?? "professional",
			useWebResearch: routeState?.retry?.research_enabled ?? false,
			researchResultCount: DEFAULT_RESEARCH_RESULTS,
			selectedTemplateId: CARD_TEMPLATES.find(
				(template) => template.theme === routeState?.retry?.theme,
			)?.id,
			retry: routeState?.retry,
			retryPresentationId: routeState?.retryPresentationId,
		},
		isGenerateDraft,
		routeState?.retry ? location.key : undefined,
	);
	const {
		prompt,
		slideCount,
		detailLevel,
		tonality,
		useWebResearch,
		researchResultCount,
		selectedTemplateId,
		retry,
		retryPresentationId,
	} = draft;
	const change = <K extends keyof GenerateDraft>(key: K, value: GenerateDraft[K]) =>
		setDraft((current) => ({ ...current, [key]: value }));
	const setPrompt = (value: string) => change("prompt", value);
	const setSelectedTemplateId = (value: string | undefined) => change("selectedTemplateId", value);
	const [loading, setLoading] = useState(false);
	// Raised by pressing Generate with nothing selected. Nothing is preselected
	// and nothing stands in for a choice, so the reader is told at the moment
	// they ask for a deck rather than prompted before they have asked.
	const [templateWarning, setTemplateWarning] = useState(false);
	const navigate = useNavigate();
	const { streamingState } = useStreaming();
	const library = useTemplateLibrary();
	const theme = selectedTemplateId ? getCardTemplate(selectedTemplateId)?.theme : undefined;
	const templateNotice =
		retry?.theme && !selectedTemplateId
			? "This presentation was generated with a template this build no longer offers. Choose a template to retry it."
			: "";

	const handleTemplateChange = (templateId: string) => {
		setTemplateWarning(false);
		setSelectedTemplateId(templateId);
	};

	// Removing the template a deck was about to be generated with leaves nothing
	// selected. Quietly moving to another one would generate in a template the
	// reader did not choose.
	const handleTemplateRemove = (templateId: string) => {
		try {
			library.setInstalled(templateId, false);
		} catch {
			return;
		}
		if (selectedTemplateId === templateId) setSelectedTemplateId(undefined);
	};

	useEffect(() => {
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			if (
				e.key.toLowerCase() === "f" &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.altKey &&
				document.activeElement?.tagName !== "INPUT" &&
				document.activeElement?.tagName !== "TEXTAREA"
			) {
				e.preventDefault();
				const input = document.getElementById("prompt");
				if (input) {
					input.focus();
				}
			}
		};

		window.addEventListener("keydown", handleGlobalKeyDown);
		return () => window.removeEventListener("keydown", handleGlobalKeyDown);
	}, []);

	const handleGenerateInternal = async (selectedPrompt: string) => {
		const normalizedPrompt = selectedPrompt.trim();
		if (!normalizedPrompt || streamingState.isStreaming || !theme) return;

		setLoading(true);

		const count = parseInt(slideCount, 10);

		if (useWebResearch) {
			navigate(ROUTES.research, {
				state: {
					prompt: normalizedPrompt,
					slideCount: count,
					detailLevel,
					tonality,
					maxResults: researchResultCount,
					retryPresentationId,
					theme,
					...(retry?.ai ? { ai: retry.ai } : {}),
				},
			});
			return;
		}

		// A failed deck's approved outline still fits while the topic and length
		// are unchanged, so it is offered again instead of a new, paid one.
		const plan =
			retry?.plan && normalizedPrompt === retry.prompt.trim() && count === retrySlideCount(retry)
				? retry.plan
				: undefined;

		navigate(ROUTES.outline, {
			state: {
				prompt: normalizedPrompt,
				slideCount: count,
				detailLevel,
				tonality,
				retryPresentationId,
				theme,
				...(retry?.ai ? { ai: retry.ai } : {}),
				...(plan ? { plan } : {}),
			},
		});
	};

	const debouncedGenerate = useDebouncedCallback(handleGenerateInternal, {
		wait: 500,
		leading: true,
	});

	const handleGenerate = () => {
		if (!prompt.trim()) return;
		if (!theme) {
			setTemplateWarning(true);
			return;
		}

		setTemplateWarning(false);
		debouncedGenerate(prompt);
	};

	const enterActionRef = useRef<() => void>(() => {});
	enterActionRef.current = () => {
		if (!prompt.trim()) {
			document.getElementById("prompt")?.focus();
			return;
		}
		if (!loading && !streamingState.isStreaming) {
			handleGenerate();
		}
	};

	useEffect(() => {
		const handleGlobalEnter = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')
			) {
				return;
			}
			event.preventDefault();
			window.setTimeout(() => enterActionRef.current(), 0);
		};

		window.addEventListener("keydown", handleGlobalEnter, true);
		return () => window.removeEventListener("keydown", handleGlobalEnter, true);
	}, []);

	return (
		<div className="flex min-h-dvh w-full flex-col overflow-x-hidden bg-transparent">
			<Header />
			<FloatingNotice
				warning={templateWarning ? "Select a template before generating." : null}
				onDismiss={() => setTemplateWarning(false)}
			/>

			<div
				data-horizon-reveal
				data-generation-selectors
				className="relative flex w-full flex-col items-center px-4 pt-6 md:pt-8"
			>
				<GenerateOptionsBar
					detailLevel={detailLevel}
					tonality={tonality}
					useWebResearch={useWebResearch}
					researchResultCount={researchResultCount}
					slideCount={slideCount}
					selectedTemplateId={selectedTemplateId}
					installedTemplateIds={library.ids}
					onDetailLevelChange={(value) => change("detailLevel", value)}
					onTonalityChange={(value) => change("tonality", value)}
					onUseWebResearchChange={(value) => change("useWebResearch", value)}
					onResearchResultCountChange={(value) => change("researchResultCount", value)}
					onSlideCountChange={(value) => change("slideCount", value)}
					onTemplateChange={handleTemplateChange}
					onTemplateRemove={handleTemplateRemove}
				/>
				{templateNotice && (
					<p className="mt-3 text-sm text-amber-200/70" role="status">
						{templateNotice}
					</p>
				)}
			</div>

			<main
				data-horizon-reveal
				className="flex w-full flex-1 items-center justify-center overflow-y-auto px-4 py-12 md:px-8"
			>
				<div className="w-full max-w-5xl">
					<div className="relative -top-4 mx-auto flex w-full max-w-4xl flex-col items-center justify-center md:-top-6">
						<GenerateForm
							prompt={prompt}
							loading={loading || streamingState.isStreaming}
							onPromptChange={setPrompt}
							onGenerate={handleGenerate}
						/>
					</div>
				</div>
			</main>
		</div>
	);
}
