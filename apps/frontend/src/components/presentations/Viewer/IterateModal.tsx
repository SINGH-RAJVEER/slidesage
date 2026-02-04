import { ChevronDown, Globe, Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";

interface IterateModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onIterate: (
		prompt: string,
		slideCount: number,
		detailLevel: string,
		tonality: string,
		useWebResearch: boolean,
	) => void;
	isStreaming: boolean;
}

export default function IterateModal({
	open,
	onOpenChange,
	onIterate,
	isStreaming,
}: IterateModalProps) {
	const [iteratePrompt, setIteratePrompt] = useState("");
	const [slideCount, setSlideCount] = useState("5");
	const [slideCountMode, setSlideCountMode] = useState("preset");
	const [customSlideCount, setCustomSlideCount] = useState("5");
	const [detailLevel, setDetailLevel] = useState("balanced");
	const [tonality, setTonality] = useState("professional");
	const [useWebResearch, setUseWebResearch] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

	const handleSubmit = () => {
		if (iteratePrompt.trim()) {
			const count =
				slideCountMode === "preset"
					? parseInt(slideCount, 10)
					: parseInt(customSlideCount, 10);
			onIterate(iteratePrompt, count, detailLevel, tonality, useWebResearch);
			setIteratePrompt("");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md text-white text-[1.05rem]">
				<DialogHeader className="space-y-3 pb-4">
					<DialogTitle className="flex items-center gap-2 text-white text-[1.9rem]">
						<Sparkles className="h-6 w-6" />
						Iterate on Presentation
					</DialogTitle>
					<div className="h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
				</DialogHeader>
				<div className="space-y-6">
					<div className="space-y-3">
						<label
							htmlFor="iteratePrompt"
							className="block text-xl font-medium text-white/80"
						>
							Describe Your Changes
						</label>
						<Textarea
							id="iteratePrompt"
							ref={textareaRef}
							placeholder="e.g., 'Add more details to slide 3', 'Make it more casual', 'Add charts'"
							value={iteratePrompt}
							onChange={(e) => handlePromptChange(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey && iteratePrompt.trim()) {
									e.preventDefault();
									handleSubmit();
								}
							}}
							className="text-xl bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 min-h-[72px] resize-none"
							disabled={isStreaming}
						/>
					</div>

					<div className="flex items-center justify-between gap-4 pt-2">
						<div className="flex items-center gap-2">
							<span className="text-white/70 text-base font-medium">Web:</span>
							<Button
								type="button"
								variant="outline"
								disabled={isStreaming}
								aria-pressed={useWebResearch}
								onClick={() => setUseWebResearch((prev) => !prev)}
								className={`w-24 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between ${
									useWebResearch ? "bg-white/20 border-white/30" : ""
								}`}
							>
								<span className="flex items-center">
									<Globe className="h-4 w-4 mr-2 opacity-70" />
									{useWebResearch ? "On" : "Off"}
								</span>
							</Button>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-white/70 text-base font-medium">
								Detail:
							</span>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="outline"
										className="w-40 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
										disabled={isStreaming}
									>
										{detailLevel.charAt(0).toUpperCase() + detailLevel.slice(1)}
										<ChevronDown className="h-4 w-4 ml-2 opacity-50" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent className="w-40 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
									<DropdownMenuItem
										onClick={() => setDetailLevel("brief")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Brief
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setDetailLevel("concise")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Concise
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setDetailLevel("balanced")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Balanced
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setDetailLevel("detailed")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Detailed
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setDetailLevel("comprehensive")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Comprehensive
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>

						<div className="flex items-center gap-2">
							<span className="text-white/70 text-base font-medium">
								Tonality:
							</span>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="outline"
										className="w-36 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
										disabled={isStreaming}
									>
										{tonality.charAt(0).toUpperCase() + tonality.slice(1)}
										<ChevronDown className="h-4 w-4 ml-2 opacity-50" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent className="w-36 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
									<DropdownMenuItem
										onClick={() => setTonality("professional")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Professional
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setTonality("casual")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Casual
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setTonality("enthusiastic")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Enthusiastic
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setTonality("persuasive")}
										className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
									>
										Persuasive
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>

						<div className="flex items-center gap-2">
							<span className="text-white/70 text-sm font-medium">Slides:</span>
							{slideCountMode === "preset" ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											className="w-24 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
											disabled={isStreaming}
										>
											{slideCount}
											<ChevronDown className="h-4 w-4 ml-2 opacity-50" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent className="w-24 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
										<DropdownMenuItem
											onClick={() => {
												setSlideCount("5");
												setCustomSlideCount("5");
												setSlideCountMode("preset");
											}}
											className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
										>
											5
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => {
												setSlideCount("10");
												setCustomSlideCount("10");
												setSlideCountMode("preset");
											}}
											className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
										>
											10
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => {
												setSlideCount("15");
												setCustomSlideCount("15");
												setSlideCountMode("preset");
											}}
											className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
										>
											15
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => {
												setSlideCount("20");
												setCustomSlideCount("20");
												setSlideCountMode("preset");
											}}
											className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
										>
											20
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => {
												setSlideCount("25");
												setCustomSlideCount("25");
												setSlideCountMode("preset");
											}}
											className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
										>
											25
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => {
												setSlideCount("30");
												setCustomSlideCount("30");
												setSlideCountMode("preset");
											}}
											className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
										>
											30
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => setSlideCountMode("custom")}
											className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
										>
											Custom
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							) : (
								<input
									type="number"
									min={1}
									max={35}
									value={customSlideCount}
									onChange={(e) => {
										const val = e.target.value;
										if (/^\d{0,2}$/.test(val) && Number(val) <= 35) {
											setCustomSlideCount(val);
										}
									}}
									onBlur={() => {
										let val = Number(customSlideCount);
										if (Number.isNaN(val) || val < 1) val = 1;
										if (val > 35) val = 35;
										setCustomSlideCount(val.toString());
										setSlideCount(val.toString());
										setSlideCountMode("preset");
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											let val = Number(customSlideCount);
											if (Number.isNaN(val) || val < 1) val = 1;
											if (val > 35) val = 35;
											setCustomSlideCount(val.toString());
											setSlideCount(val.toString());
											setSlideCountMode("preset");
										} else if (e.key === "Escape") {
											setSlideCountMode("preset");
										}
									}}
									disabled={isStreaming}
									className="w-24 px-3 py-2 rounded-md border border-white/20 bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-400 hide-number-spin disabled:opacity-50 disabled:cursor-not-allowed"
									placeholder="1-35"
									inputMode="numeric"
									style={{ MozAppearance: "textfield" }}
								/>
							)}
						</div>
					</div>

					<div className="flex justify-center pt-4">
						<Button
							onClick={handleSubmit}
							disabled={!iteratePrompt.trim() || isStreaming}
							className="w-1/2 bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-14 text-lg font-semibold"
						>
							{isStreaming ? (
								<>
									<Loader2 className="mr-2 h-5 w-5 animate-spin" />
									Generating
								</>
							) : (
								<>
									<Sparkles className="mr-2 h-5 w-5" />
									Generate Iteration
								</>
							)}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
