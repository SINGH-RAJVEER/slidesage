import {
	BINARY_PPTX_TEMPLATE_CATALOG,
	BINARY_TEMPLATE_CATEGORIES,
	type BinaryTemplateCategory,
	type PresentationTemplateReference,
} from "@slidesage/types";
import { Badge } from "@slidesage/ui/components/badge";
import { Button } from "@slidesage/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@slidesage/ui/components/dropdown-menu";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { templateIsSelectable } from "../../lib/template-selection";
import { MarqueeText } from "./MarqueeText";

export interface InstalledTemplateOption {
	marketplaceId: string;
	name: string;
	description: string;
	templateReference: PresentationTemplateReference;
	thumbnailPath: string;
}

interface TemplateSelectorProps {
	/** Undefined until the reader picks one; there is no default to assume. */
	selectedTemplate?: PresentationTemplateReference;
	onTemplateChange: (template: PresentationTemplateReference) => void;
	/** Removes a theme from the reader's library. Absent hides the control. */
	onTemplateRemove?: (theme: InstalledTemplateOption) => void;
	className?: string;
	installedThemes?: InstalledTemplateOption[];
}

interface TemplateOption {
	theme: InstalledTemplateOption;
	category?: BinaryTemplateCategory;
}

interface TemplateColumn {
	label: string;
	options: TemplateOption[];
}

/**
 * A category is one column, however tall it gets. The menu widens as the reader
 * installs themes from categories they had none in, and lengthens as they
 * install more within one, so a category always reads as a single list.
 */
const COLUMN_WIDTH_REM = 15;
const MIN_WIDTH_REM = 18;
const MAX_VIEWPORT_FRACTION = 0.92;

function panelWidthRem(columnCount: number): number {
	return Math.max(MIN_WIDTH_REM, columnCount * COLUMN_WIDTH_REM);
}

/**
 * How far to shift a trigger-aligned panel so it sits centred on the page.
 *
 * Exported because a browser test cannot check this: the offset is applied as a
 * transform by the positioning library, and no layout runs under jsdom.
 */
export function centredAlignOffset(measurements: {
	columnCount: number;
	triggerLeft: number;
	viewportWidth: number;
	rootFontSize: number;
}): number {
	const { columnCount, triggerLeft, viewportWidth, rootFontSize } = measurements;
	const width = Math.min(
		viewportWidth * MAX_VIEWPORT_FRACTION,
		panelWidthRem(columnCount) * rootFontSize,
	);
	return Math.round((viewportWidth - width) / 2 - triggerLeft);
}

/**
 * The menu lists the reader's installed themes, grouped by what a template is
 * for, because that is what they are choosing between. Every template is a
 * marketplace template, so nothing here is labelled by where it came from.
 */
function templateColumns(installedThemes: InstalledTemplateOption[]): TemplateColumn[] {
	const options: TemplateOption[] = installedThemes.map((theme) => ({
		theme,
		// Grouping follows the catalog entry. A theme this build does not carry
		// keeps its place in the menu under Installed rather than being filed
		// under a category nobody assigned it.
		category: BINARY_PPTX_TEMPLATE_CATALOG.find(
			(template) => template.id === theme.templateReference.id,
		)?.category,
	}));
	const groups = [
		...BINARY_TEMPLATE_CATEGORIES.map((category) => ({
			label: category.label,
			options: options.filter((option) => option.category === category.id),
		})),
		{ label: "Installed", options: options.filter((option) => !option.category) },
	].filter((group) => group.options.length > 0);

	return groups;
}

const TemplateSelector: React.FC<TemplateSelectorProps> = ({
	selectedTemplate,
	onTemplateChange,
	onTemplateRemove,
	className = "",
	installedThemes = [],
}) => {
	const columns = templateColumns(installedThemes);
	const currentTemplate = BINARY_PPTX_TEMPLATE_CATALOG.find(
		(template) =>
			template.id === selectedTemplate?.id && template.version === selectedTemplate.version,
	);

	// The panel is wide enough to be a page-level surface rather than something
	// hanging off a control, so it is centred on the page instead of on the
	// trigger. A menu is positioned against its trigger, so centring is the
	// distance from the trigger's left edge to where a centred panel starts,
	// remeasured whenever the menu opens or the window changes size.
	//
	// The offset is applied with align="start" deliberately: floating-ui ignores
	// an alignment offset when the alignment is center, so align="center" would
	// centre on the trigger and silently drop this.
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [alignOffset, setAlignOffset] = useState(0);
	const centreOnPage = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger || typeof window === "undefined") return;
		setAlignOffset(
			centredAlignOffset({
				columnCount: columns.length,
				triggerLeft: trigger.getBoundingClientRect().left,
				viewportWidth: window.innerWidth,
				rootFontSize:
					Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16,
			}),
		);
	}, [columns.length]);

	useEffect(() => {
		if (!open || typeof window === "undefined") return;
		window.addEventListener("resize", centreOnPage);
		return () => window.removeEventListener("resize", centreOnPage);
	}, [open, centreOnPage]);

	return (
		<div className={`flex items-center ${className}`}>
			<DropdownMenu
				open={open}
				onOpenChange={(next) => {
					if (next) centreOnPage();
					setOpen(next);
				}}
			>
				<DropdownMenuTrigger asChild>
					<Button
						ref={triggerRef}
						variant="ghost"
						className="flex h-12 select-none items-center gap-3 rounded-lg px-5 text-base font-light text-white/70 transition-all outline-none hover:bg-white/5 hover:text-white focus-visible:bg-white/5 focus-visible:text-white focus-visible:outline-none focus-visible:ring-0"
					>
						<span className="opacity-50">Template</span>
						<MarqueeText className="max-w-40 text-white" text={currentTemplate?.name || "Select"} />
						<ChevronDown className="h-4 w-4 opacity-50" />
					</Button>
				</DropdownMenuTrigger>

				<DropdownMenuContent
					style={
						{
							width: `${panelWidthRem(columns.length)}rem`,
							maxWidth: `${MAX_VIEWPORT_FRACTION * 100}vw`,
							"--template-columns": Math.max(1, columns.length),
						} as React.CSSProperties
					}
					className="rounded-xl border border-white/10 bg-black/40 p-2 text-white shadow-2xl backdrop-blur-xl"
					align="start"
					alignOffset={alignOffset}
					collisionPadding={16}
				>
					{columns.length === 0 ? (
						<p className="px-2 py-1 text-sm text-white/40">
							No themes installed. Add one from the marketplace.
						</p>
					) : (
						<div className="grid grid-cols-1 items-start sm:grid-cols-[repeat(var(--template-columns),minmax(0,1fr))]">
							{columns.map((column) => (
								<DropdownMenuGroup
									key={column.label}
									className="min-w-0 sm:border-l sm:border-white/5 sm:first:border-l-0"
								>
									<DropdownMenuLabel className="px-2 py-0.5 text-[10px] font-medium tracking-wider text-white/35 uppercase">
										{column.label}
									</DropdownMenuLabel>
									{column.options.map(({ theme }) => {
										const isSelected =
											selectedTemplate?.id === theme.templateReference.id &&
											selectedTemplate.version === theme.templateReference.version;
										const selectable = templateIsSelectable(theme.templateReference);

										return (
											<div key={theme.marketplaceId} className="group/theme relative">
												<DropdownMenuItem
													disabled={!selectable}
													onClick={() => {
														if (!selectable) return;
														onTemplateChange({ ...theme.templateReference });
													}}
													onKeyDown={(event) => {
														// The remove control is a sibling rather than a child, so
														// it is out of the menu's roving focus. Delete on the row
														// is the keyboard path to the same action.
														if (!onTemplateRemove) return;
														if (event.key !== "Delete" && event.key !== "Backspace") return;
														event.preventDefault();
														onTemplateRemove(theme);
													}}
													className={`my-0.5 cursor-pointer rounded-lg px-2 py-2.5 text-white/80 hover:bg-white/10 focus:bg-white/10 focus:text-white ${isSelected ? "bg-white/10" : ""}`}
												>
													<div className="flex min-w-0 flex-col">
														<div className="flex items-center gap-2">
															<span
																className={`truncate text-sm font-medium ${isSelected ? "text-white" : "text-white/70"}`}
															>
																{theme.name}
															</span>
															{isSelected && (
																<Badge
																	variant="secondary"
																	className="flex h-5 shrink-0 items-center border border-blue-500/20 bg-blue-500/20 px-1 text-[10px] text-blue-300"
																>
																	Active
																</Badge>
															)}
														</div>
														{!selectable && (
															<span className="mt-1 truncate text-xs text-white/40">
																Preparing for export
															</span>
														)}
													</div>
												</DropdownMenuItem>
												{/* Nothing here reserves width: a row is as wide as its
												    title, and the control arrives over the end of it on
												    hover, behind a short fade so it never sits on a
												    glyph. */}
												<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
													{isSelected && (
														<Check className="h-4 w-4 text-blue-400 group-hover/theme:invisible" />
													)}
												</div>
												{onTemplateRemove && (
													<div className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-lg bg-gradient-to-l from-black/80 via-black/70 to-transparent pr-2 pl-8 opacity-0 transition duration-200 group-hover/theme:opacity-100 group-focus-within/theme:opacity-100">
														<button
															type="button"
															aria-label={`Remove ${theme.name}`}
															onClick={(event) => {
																event.preventDefault();
																event.stopPropagation();
																onTemplateRemove(theme);
															}}
															// The viewer's delete control, at menu-row scale.
															className="pointer-events-auto rounded-md border border-red-500/20 bg-red-500/10 p-1 text-red-400 transition duration-200 hover:bg-red-500/20 focus-visible:outline-none"
														>
															<Trash2 className="h-3.5 w-3.5" />
														</button>
													</div>
												)}
											</div>
										);
									})}
								</DropdownMenuGroup>
							))}
						</div>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
};

export default TemplateSelector;
