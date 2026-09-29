import { Button } from "@slidesage/ui/components/button";
import { DialogHeader } from "@slidesage/ui/components/dialog";
import { Textarea } from "@slidesage/ui/components/textarea";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** What a revision rewrites: every card, or the slide on screen. */
export type IterateScope = "deck" | "slide";

interface IterateModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onIterate: (instruction: string, scope: IterateScope) => boolean | void | Promise<boolean | void>;
	/** The scope chosen when the panel opens. */
	initialScope?: IterateScope;
	/** One-based number of the slide on screen. */
	currentSlide: number;
	isStreaming: boolean;
}

const panelClassName =
	"flex h-dvh w-full flex-col gap-0 overflow-hidden border-l border-white/10 bg-[hsl(222_27%_12%)] bg-[radial-gradient(circle_at_top,hsl(220_20%_18%),hsl(222_27%_12%)_60%)] text-white shadow-2xl";
const QUICK_INSTRUCTIONS = [
	"Make it more concise",
	"Add more detail and examples",
	"Make it more persuasive",
	"Use simpler language",
];
/** The server's limit on a revision instruction. */
const INSTRUCTION_LIMIT = 400;
const optionClassName =
	"rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export default function IterateModal({
	open,
	onOpenChange,
	onIterate,
	isStreaming,
	initialScope = "deck",
	currentSlide,
}: IterateModalProps) {
	const [iteratePrompt, setIteratePrompt] = useState("");
	const [scope, setScope] = useState<IterateScope>(initialScope);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		if (open) setScope(initialScope);
	}, [open, initialScope]);

	useEffect(() => {
		if (!open) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onOpenChange(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [onOpenChange, open]);

	const handlePromptChange = (value: string) => {
		setIteratePrompt(value);
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		const maxHeight = 320;
		const nextHeight = Math.min(el.scrollHeight, maxHeight);
		el.style.height = `${nextHeight}px`;
		el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
	};

	const submit = async (instruction: string) => {
		const trimmed = instruction.trim();
		if (trimmed && !isStreaming) {
			const accepted = await onIterate(trimmed, scope);
			if (accepted === true) setIteratePrompt("");
		}
	};
	const handleSubmit = () => submit(iteratePrompt);

	const panelContent = (
		<>
			<DialogHeader className="relative space-y-2 border-b border-white/10 px-5 py-4 pr-16 text-left sm:px-6 sm:py-5">
				<button
					type="button"
					onClick={() => onOpenChange(false)}
					className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white sm:right-4 sm:top-4"
					aria-label="Close iterate sidebar"
				>
					<X className="size-4" />
				</button>
				<h2 className="text-xl font-medium tracking-tight text-white">Iterate on presentation</h2>
			</DialogHeader>
			<div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
				<div className="space-y-3">
					<Textarea
						id="iteratePrompt"
						ref={textareaRef}
						aria-label="What should change"
						placeholder="e.g., 'Tighten the wording and lead with the numbers', 'Make it more casual'"
						value={iteratePrompt}
						maxLength={INSTRUCTION_LIMIT}
						onChange={(e) => handlePromptChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey && iteratePrompt.trim()) {
								e.preventDefault();
								handleSubmit();
							}
						}}
						className="min-h-40 resize-none rounded-lg border-white/10 bg-black/20 p-4 text-base leading-6 text-white placeholder:text-white/35 focus-visible:border-white/25 focus-visible:ring-0"
						disabled={isStreaming}
					/>
				</div>

				<div className="border-t border-white/10 pt-6">
					<div className="grid gap-6">
						<div className="space-y-3">
							<p className="text-sm font-medium text-white/60">Revise</p>
							<div className="grid grid-cols-2 gap-2">
								{(
									[
										["deck", "Every slide"],
										["slide", `Slide ${currentSlide}`],
									] as const
								).map(([value, label]) => (
									<button
										key={value}
										type="button"
										disabled={isStreaming}
										aria-pressed={scope === value}
										onClick={() => setScope(value)}
										className={`${optionClassName} ${
											scope === value
												? "border-white/20 bg-white/10 text-white"
												: "border-white/5 bg-black/10 text-white/55 hover:border-white/10 hover:bg-white/5 hover:text-white/80"
										}`}
									>
										{label}
									</button>
								))}
							</div>
						</div>

						<div className="space-y-3">
							<p className="text-sm font-medium text-white/60">Quick changes</p>
							<div className="grid grid-cols-2 gap-2">
								{QUICK_INSTRUCTIONS.map((quick) => (
									<button
										key={quick}
										type="button"
										disabled={isStreaming}
										onClick={() => void submit(quick)}
										className={`${optionClassName} border-white/5 bg-black/10 text-left text-white/55 hover:border-white/10 hover:bg-white/5 hover:text-white/80`}
									>
										{quick}
									</button>
								))}
							</div>
						</div>
						<p className="text-sm text-white/50">
							A revision keeps the number and order of slides. Everything outside the chosen slides
							stays as it is, and the result is saved as a new version.
						</p>
					</div>
				</div>
			</div>
			<div className="border-t border-white/10 bg-black/20 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-6">
				<Button
					onClick={handleSubmit}
					disabled={!iteratePrompt.trim() || isStreaming}
					className="h-11 w-full rounded-md border border-white/20 bg-white/10 font-medium text-white transition-colors hover:bg-white/15"
				>
					{isStreaming ? (
						<>
							<ThinkingOrb size={20} className="mr-2" />
							Generating...
						</>
					) : (
						<>
							<Sparkles className="mr-2 size-4" />
							Generate revision
						</>
					)}
				</Button>
			</div>
		</>
	);

	return (
		<>
			{open && (
				<button
					type="button"
					className="fixed inset-0 z-40 bg-black/45 xl:hidden"
					onClick={() => onOpenChange(false)}
					aria-label="Dismiss iterate panel"
				/>
			)}
			<aside
				className={`viewer-iterate-panel ${panelClassName} fixed inset-y-0 right-0 z-50 max-w-full xl:static xl:z-auto xl:shrink-0 ${
					open ? "viewer-iterate-panel--open" : "viewer-iterate-panel--closed"
				}`}
				aria-label="Iterate on presentation"
				aria-hidden={!open}
				inert={!open ? true : undefined}
			>
				{panelContent}
			</aside>
		</>
	);
}
