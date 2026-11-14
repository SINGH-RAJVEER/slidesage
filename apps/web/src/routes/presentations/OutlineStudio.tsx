import type { LayoutId } from "@slidesage/cards";
import { Button } from "@slidesage/ui/components/button";
import { LAYOUT_NAMES } from "@slidesage/ui/components/Cards";
import { Input } from "@slidesage/ui/components/input";
import { Sheet, SheetContent, SheetTitle } from "@slidesage/ui/components/sheet";
import { Textarea } from "@slidesage/ui/components/textarea";
import { useIsMobile } from "@slidesage/ui/hooks/useIsMobile";
import { cn } from "@slidesage/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { LayoutGlyph } from "./LayoutGlyph";
import { AddCardButton, OutlineActionBar, QUIET_FIELD, RowActions } from "./OutlineControls";
import { isImageLayout, type OutlineEditor } from "./useOutlineEditor";

/** A point is one line of thought, however it wraps; Enter does not break it. */
function keepOnOneLine(event: KeyboardEvent<HTMLTextAreaElement>) {
	if (event.key === "Enter") event.preventDefault();
}

/** The chosen card's layout and photo, with a wireframe of what will be written. */
function CardDetail({ editor, index }: { editor: OutlineEditor; index: number }) {
	const entry = editor.outline?.cards[index];
	if (!entry) return null;
	const photo = isImageLayout(entry.layout);
	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-baseline justify-between text-sm font-light mobile:hidden">
				<span className="text-white/40">Card {index + 1}</span>
				<span className="text-white/70">{LAYOUT_NAMES[entry.layout as LayoutId]}</span>
			</div>
			<LayoutGlyph
				layout={entry.layout}
				className="aspect-[16/9] w-full rounded-lg bg-white/[0.03] text-white/70 mobile:hidden"
			/>
			<fieldset
				aria-label={`Card ${index + 1} layout`}
				className="m-0 grid min-w-0 border-0 p-0 grid-cols-3 gap-1 desktop:grid-cols-4"
			>
				{editor.layouts.map((layout) => {
					const selected = layout === entry.layout;
					return (
						<Button
							key={layout}
							type="button"
							variant="ghost"
							aria-pressed={selected}
							onClick={() => editor.setLayout(index, layout)}
							className={cn(
								"h-auto flex-col gap-1.5 rounded-lg p-2 text-xs font-light hover:bg-white/5 hover:text-white",
								selected ? "bg-white/10 text-white" : "text-white/45",
							)}
						>
							<LayoutGlyph
								layout={layout}
								className="aspect-[16/9] size-auto w-full"
							/>
							{LAYOUT_NAMES[layout as LayoutId]}
						</Button>
					);
				})}
			</fieldset>
			{photo && (
				<div className="flex items-center gap-2 text-sm font-light text-white/40">
					Photo
					<Input
						aria-label={`Card ${index + 1} photo search`}
						value={entry.imageQuery ?? ""}
						maxLength={100}
						placeholder="Add a photo search"
						onChange={(event) =>
							editor.update(index, { imageQuery: event.target.value })
						}
						className={`h-8 min-w-0 flex-1 px-2 font-light desktop:text-sm ${QUIET_FIELD} ${entry.imageQuery?.trim() ? "" : "placeholder:text-amber-200/70"}`}
					/>
				</div>
			)}
		</div>
	);
}

/** The deck as a list of points beside a visual picker for the chosen card. */
export function OutlineStudio({ editor }: { editor: OutlineEditor }) {
	const { outline, request } = editor;
	const compact = useIsMobile();
	const [selected, setSelected] = useState(0);
	const [sheetOpen, setSheetOpen] = useState(false);
	if (!outline) return null;
	const count = outline.cards.length;
	const active = Math.min(selected, count - 1);
	// Row actions act on a card without choosing it.
	const choose = (target: EventTarget, index: number) => {
		if (target instanceof Element && target.closest("[data-row-actions]")) return;
		setSelected(index);
	};
	const actions = {
		move: (index: number, offset: number) => {
			editor.move(index, offset);
			const target = index + offset;
			if (target >= 0 && target < count) setSelected(target);
		},
		remove: (index: number) => {
			editor.remove(index);
			if (index < active) setSelected(active - 1);
		},
	};
	return (
		<>
			<div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 mobile:flex-col mobile:overflow-y-auto">
				<main className="custom-scrollbar min-h-0 min-w-0 flex-1 px-4 pt-8 pb-6 desktop:overflow-y-auto desktop:px-8">
					<Input
						aria-label="Presentation title"
						value={outline.title}
						maxLength={120}
						onChange={(event) =>
							editor.setOutline({ ...outline, title: event.target.value })
						}
						className={`-mx-3 h-auto w-[calc(100%+1.5rem)] py-1.5 text-2xl font-light desktop:text-2xl ${QUIET_FIELD}`}
					/>
					<p className="truncate text-sm font-light text-white/40">{request?.prompt}</p>
					<ol aria-label="Outline" className="mt-5 flex flex-col gap-0.5">
						{outline.cards.map((entry, index) => (
							<li
								key={`${index}-${entry.position}`}
								onFocusCapture={(event) => choose(event.target, index)}
								onPointerDown={(event) => choose(event.target, index)}
								data-selected={index === active}
								className="group rounded-lg transition-colors desktop:hover:bg-white/[0.03] desktop:data-[selected=true]:bg-white/[0.07] mobile:border-b mobile:border-white/[0.07] mobile:rounded-none mobile:pb-2"
							>
								<div className="flex items-start gap-2 p-1.5">
									<span className="w-6 shrink-0 pt-1.5 text-right text-sm font-light text-white/30 tabular-nums">
										{index + 1}
									</span>
									<LayoutGlyph
										layout={entry.layout}
										className="mt-1 w-10 shrink-0 rounded-sm bg-white/[0.04] text-white/60 mobile:hidden"
									/>
									<Textarea
										aria-label={`Card ${index + 1} point`}
										value={entry.takeaway}
										maxLength={200}
										rows={1}
										onKeyDown={keepOnOneLine}
										placeholder="The one point this card makes"
										onChange={(event) =>
											editor.update(index, {
												takeaway: event.target.value.replace(/\n/g, " "),
											})
										}
										className="min-h-0 flex-1 resize-none border-transparent bg-transparent px-1.5 py-1 font-light text-white shadow-none placeholder:text-white/30 focus-visible:border-transparent focus-visible:ring-0"
									/>
									<RowActions index={index} count={count} editor={actions} />
								</div>
								{compact && (
									<Button
										variant="ghost"
										aria-label={`Card ${index + 1} layout: ${LAYOUT_NAMES[entry.layout as LayoutId]}`}
										onClick={() => {
											setSelected(index);
											setSheetOpen(true);
										}}
										className="ml-8 h-8 max-w-[calc(100%-2rem)] justify-start gap-2 px-2 text-sm font-light hover:bg-white/5"
									>
										<span className="text-white/40">Layout</span>
										<span className="text-white">
											{LAYOUT_NAMES[entry.layout as LayoutId]}
										</span>
										{isImageLayout(entry.layout) && (
											<span
												className={cn(
													"min-w-0 truncate",
													entry.imageQuery?.trim()
														? "text-white/50"
														: "text-amber-200/70",
												)}
											>
												{entry.imageQuery?.trim() || "Add a photo search"}
											</span>
										)}
										<ChevronDown className="size-4 shrink-0 text-white/40" />
									</Button>
								)}
							</li>
						))}
					</ol>
					<div className="pt-2 pl-8">
						<AddCardButton editor={editor} />
					</div>
				</main>
				{compact && (
					<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
						<SheetContent side="bottom" aria-describedby={undefined}>
							<SheetTitle className="font-light">Card {active + 1} layout</SheetTitle>
							<CardDetail editor={editor} index={active} />
						</SheetContent>
					</Sheet>
				)}
				{!compact && (
					<aside
						aria-label="Selected card"
						className="custom-scrollbar w-[26rem] shrink-0 overflow-y-auto border-l border-white/10 px-6 pt-8 pb-6"
					>
						<CardDetail editor={editor} index={active} />
					</aside>
				)}
			</div>
			<OutlineActionBar editor={editor} />
		</>
	);
}
