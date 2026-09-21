import {
	BINARY_PPTX_TEMPLATE_CATALOG,
	type PresentationRetryOptions,
	type PresentationTemplateReference,
} from "@slidesage/types";
import { useStreaming } from "@slidesage/ui";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { GenerateForm, GenerateOptionsBar } from "@slidesage/ui/components/Generate";
import type { InstalledTemplateOption } from "@slidesage/ui/components/Generate/TemplateSelector";
import { useInstalledMarketplaceThemes } from "@slidesage/ui/hooks/useInstalledMarketplaceThemes";
import { requestGenerationNotificationPermission } from "@slidesage/ui/lib/generation-notifications";
import { removeMarketplaceTheme } from "@slidesage/ui/lib/marketplace-themes";
import { templateIsSelectable } from "@slidesage/ui/lib/template-selection";
import { useDebouncedCallback } from "@tanstack/react-pacer/debouncer";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { useHorizonPageReady } from "../../app/transitions/HorizonTransition";

interface GenerateRouteState {
	retry?: PresentationRetryOptions;
	retryPresentationId?: string;
}

// A retried presentation names the template it was generated from. Standing a
// default in for one this build does not carry would generate the retry in a
// template the reader never chose, so an unknown reference leaves the selector
// empty and says so.
function templateSelection(
	reference: PresentationRetryOptions["template"],
): PresentationTemplateReference | undefined {
	if (!reference) return undefined;
	const template = BINARY_PPTX_TEMPLATE_CATALOG.find(
		(candidate) => candidate.id === reference.id && candidate.version === reference.version,
	);
	if (!template) return undefined;
	return { id: template.id, version: template.version };
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
	const [selectedTemplate, setSelectedTemplate] = useState(() =>
		templateSelection(retry?.template),
	);
	// Raised by pressing Generate with nothing selected. Nothing is preselected
	// and nothing stands in for a choice, so the reader is told at the moment
	// they ask for a deck rather than prompted before they have asked. It is
	// transient, so it goes to the floating notice rather than the inline one
	// that describes a standing template problem.
	const [templateWarning, setTemplateWarning] = useState(false);
	const navigate = useNavigate();
	const { streamingState, generate } = useStreaming();
	const installedThemes = useInstalledMarketplaceThemes();
	const templateSelectable = selectedTemplate ? templateIsSelectable(selectedTemplate) : false;
	const generationDisabled = Boolean(selectedTemplate) && !templateSelectable;
	const templateNotice =
		retry?.template && !selectedTemplate
			? "This presentation was generated with a template this build no longer offers. Choose a template to retry it."
			: selectedTemplate && !templateSelectable
				? "The selected template is not ready for generation yet."
				: "";

	const handleTemplateChange = (template: PresentationTemplateReference) => {
		setTemplateWarning(false);
		setSelectedTemplate(template);
	};

	// Removing the theme a deck was about to be generated with leaves nothing
	// selected. Quietly moving to another one would generate in a template the
	// reader did not choose.
	const handleTemplateRemove = (theme: InstalledTemplateOption) => {
		if (!removeMarketplaceTheme(theme.marketplaceId)) return;
		if (
			selectedTemplate?.id === theme.templateReference.id &&
			selectedTemplate.version === theme.templateReference.version
		) {
			setSelectedTemplate(undefined);
		}
	};

	useEffect(() => {
		if (streamingState.error) {
			console.error("Presentation generation failed:", streamingState.error);
			setLoading(false);
		}
	}, [streamingState.error]);

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
		if (!normalizedPrompt || streamingState.isStreaming || generationDisabled || !selectedTemplate)
			return;

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
					template: selectedTemplate,
					...(retry?.ai ? { ai: retry.ai } : {}),
				},
			});
			return;
		}

		const streamingRequest = generate({
			prompt: normalizedPrompt,
			slideCount: count,
			detailLevel,
			tonality,
			retryPresentationId,
			ai: retry?.ai,
			template: selectedTemplate,
		});
		navigate(ROUTES.presentation, {
			state: { isStreaming: true },
		});

		const success = await streamingRequest;
		if (!success) {
			setLoading(false);
		}
	};

	const debouncedGenerate = useDebouncedCallback(handleGenerateInternal, {
		wait: 500,
		leading: true,
	});

	const handleGenerate = () => {
		if (!prompt.trim() || generationDisabled) return;
		if (!selectedTemplate) {
			setTemplateWarning(true);
			return;
		}

		setTemplateWarning(false);
		requestGenerationNotificationPermission();
		debouncedGenerate(prompt);
	};

	const enterActionRef = useRef<() => void>(() => {});
	enterActionRef.current = () => {
		if (!prompt.trim()) {
			document.getElementById("prompt")?.focus();
			return;
		}
		if (!loading && !streamingState.isStreaming && !generationDisabled) {
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
					selectedTemplate={selectedTemplate}
					installedThemes={installedThemes}
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
							generationDisabled={generationDisabled}
							onPromptChange={setPrompt}
							onGenerate={handleGenerate}
						/>
					</div>
				</div>
			</main>
		</div>
	);
}
