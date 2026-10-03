import { CARD_TEMPLATES, getCardTemplate } from "@slidesage/cards";
import type { PresentationRetryOptions } from "@slidesage/types";
import { useStreaming } from "@slidesage/ui";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { GenerateForm, GenerateOptionsBar } from "@slidesage/ui/components/Generate";
import { useDebouncedCallback } from "@tanstack/react-pacer/debouncer";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { useHorizonPageReady } from "../../app/transitions/HorizonTransition";
import { useTemplateLibrary } from "../marketplace/template-library";

interface GenerateRouteState {
	retry?: PresentationRetryOptions;
	retryPresentationId?: string;
}

export default function GeneratePPTPage() {
	useHorizonPageReady();
	const location = useLocation();
	const retry = (location.state as GenerateRouteState | null)?.retry;
	const retryPresentationId = (location.state as GenerateRouteState | null)?.retryPresentationId;
	const retryPrompt = retry?.prompt.trim() ?? "";
	const retrySlideCount = Math.min(40, Math.max(5, retry?.slide_count ?? 5)).toString();
	const [prompt, setPrompt] = useState(retryPrompt);
	const [loading, setLoading] = useState(false);
	const [slideCount, setSlideCount] = useState(retrySlideCount);
	const [detailLevel, setDetailLevel] = useState(retry?.detail_level ?? "balanced");
	const [tonality, setTonality] = useState(retry?.tonality ?? "professional");
	const [useWebResearch, setUseWebResearch] = useState(retry?.research_enabled ?? false);
	// A retried presentation names the theme it was generated in. Standing a
	// default in for one this build does not carry would generate the retry in a
	// template the reader never chose, so an unknown theme leaves nothing selected.
	const [selectedTemplateId, setSelectedTemplateId] = useState(
		() => CARD_TEMPLATES.find((template) => template.theme === retry?.theme)?.id,
	);
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
					retryPresentationId,
					theme,
					...(retry?.ai ? { ai: retry.ai } : {}),
				},
			});
			return;
		}

		navigate(ROUTES.outline, {
			state: {
				prompt: normalizedPrompt,
				slideCount: count,
				detailLevel,
				tonality,
				retryPresentationId,
				theme,
				...(retry?.ai ? { ai: retry.ai } : {}),
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
					slideCount={slideCount}
					selectedTemplateId={selectedTemplateId}
					installedTemplateIds={library.ids}
					onDetailLevelChange={setDetailLevel}
					onTonalityChange={setTonality}
					onUseWebResearchChange={setUseWebResearch}
					onSlideCountChange={setSlideCount}
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
