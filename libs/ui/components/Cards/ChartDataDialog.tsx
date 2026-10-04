import {
	CARD_SCHEMA_VERSION,
	type Card,
	type CardDocument,
	type ChartData,
	type ChartNode,
	DEFAULT_THEME,
	LIMITS,
	parseCard,
	SchemaError,
	setChartData,
} from "@slidesage/cards";
import { Button } from "@slidesage/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@slidesage/ui/components/dialog";
import { Input } from "@slidesage/ui/components/input";
import { Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { DocumentEdit } from "./fields";

interface Draft {
	categories: string[];
	series: { id?: string; name: string; values: string[] }[];
	prefix: string;
	suffix: string;
	caption: string;
}

function draftOf(node: ChartNode): Draft {
	return {
		categories: [...node.categories],
		series: node.series.map((series) => ({
			id: series.id,
			name: series.name,
			values: series.values.map(String),
		})),
		prefix: node.prefix ?? "",
		suffix: node.suffix ?? "",
		caption: node.caption ?? "",
	};
}

/** Reads a typed value, allowing thousands separators but no units. */
export function parseValue(text: string): number | null {
	const plain = text.replace(/[,\s]/g, "").replace(/^−/, "-");
	return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : null;
}

/** The draft as chart data, or the first problem a reader would need to fix. */
function readDraft(draft: Draft): ChartData | string {
	if (draft.categories.some((category) => category.trim() === "")) {
		return "Every category needs a name.";
	}
	const names = draft.categories.map((category) => category.trim());
	if (new Set(names).size !== names.length) return "Category names must not repeat.";
	if (draft.series.some((series) => series.name.trim() === "")) return "Every series needs a name.";
	const series: ChartData["series"] = [];
	for (const entry of draft.series) {
		const values: number[] = [];
		for (const [index, text] of entry.values.entries()) {
			const value = parseValue(text);
			if (value === null) {
				return `“${text || "(blank)"}” for ${entry.name} in ${names[index]} is not a number.`;
			}
			values.push(value);
		}
		series.push({ id: entry.id, name: entry.name.trim(), values });
	}
	return {
		categories: names,
		series,
		prefix: draft.prefix,
		suffix: draft.suffix,
		caption: draft.caption,
	};
}

export interface ChartDataDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	card: Card;
	node: ChartNode;
	edit: DocumentEdit;
}

/**
 * Edits a chart's numbers as a grid: categories down the side, one column per
 * series. Saving checks the result with the card schema, so a chart is never
 * saved in a shape its kind or layout cannot show.
 */
export function ChartDataDialog({ open, onOpenChange, card, node, edit }: ChartDataDialogProps) {
	const [draft, setDraft] = useState(() => draftOf(node));
	const [problem, setProblem] = useState<string | null>(null);
	const id = useId();

	useEffect(() => {
		if (open) {
			setDraft(draftOf(node));
			setProblem(null);
		}
	}, [open, node]);

	const update = (change: (current: Draft) => Draft) => {
		setDraft(change);
		setProblem(null);
	};

	const save = () => {
		const data = readDraft(draft);
		if (typeof data === "string") {
			setProblem(data);
			return;
		}
		// Check the card as it would be saved, so the schema has the final say.
		const alone: CardDocument = {
			schemaVersion: CARD_SCHEMA_VERSION,
			title: "",
			theme: DEFAULT_THEME,
			cardOrder: [card.id],
			cards: { [card.id]: card },
		};
		try {
			parseCard(setChartData(alone, card.id, node.id, data).cards[card.id], "card", {
				seen: new Set(),
			});
		} catch (error) {
			if (!(error instanceof SchemaError)) throw error;
			setProblem(`This chart cannot be saved: ${error.issue.message}.`);
			return;
		}
		edit((document) => setChartData(document, card.id, node.id, data));
		onOpenChange(false);
	};

	const canAddCategory = draft.categories.length < LIMITS.chartCategories.max;
	const canRemoveCategory = draft.categories.length > LIMITS.chartCategories.min;
	const canAddSeries = draft.series.length < LIMITS.chartSeries.max;
	const canRemoveSeries = draft.series.length > LIMITS.chartSeries.min;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>Chart data</DialogTitle>
					<DialogDescription>
						Categories run down the side and each series is a column. Values are plain numbers; put
						units in the prefix or suffix.
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-[50vh] overflow-auto">
					<table className="w-full border-separate border-spacing-1 text-sm">
						<thead>
							<tr>
								<th className="w-40 text-left font-medium text-muted-foreground">Category</th>
								{draft.series.map((series, seriesIndex) => (
									<th key={series.id ?? `new-${seriesIndex}`} className="min-w-28">
										<div className="flex items-center gap-1">
											<Input
												aria-label={`Series ${seriesIndex + 1} name`}
												value={series.name}
												maxLength={LIMITS.seriesName}
												onChange={(event) =>
													update((current) => ({
														...current,
														series: current.series.map((entry, index) =>
															index === seriesIndex
																? { ...entry, name: event.target.value }
																: entry,
														),
													}))
												}
											/>
											{canRemoveSeries && (
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="size-7 shrink-0"
													aria-label={`Remove series ${series.name || seriesIndex + 1}`}
													onClick={() =>
														update((current) => ({
															...current,
															series: current.series.filter((_, index) => index !== seriesIndex),
														}))
													}
												>
													<X className="size-3.5" />
												</Button>
											)}
										</div>
									</th>
								))}
								{canAddSeries && (
									<th className="w-10">
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="size-8"
											aria-label="Add series"
											onClick={() =>
												update((current) => ({
													...current,
													series: [
														...current.series,
														{
															name: `Series ${current.series.length + 1}`,
															values: current.categories.map(() => "0"),
														},
													],
												}))
											}
										>
											<Plus className="size-4" />
										</Button>
									</th>
								)}
							</tr>
						</thead>
						<tbody>
							{draft.categories.map((category, categoryIndex) => (
								<tr key={categoryIndex}>
									<td>
										<div className="flex items-center gap-1">
											<Input
												aria-label={`Category ${categoryIndex + 1}`}
												value={category}
												maxLength={LIMITS.categoryLabel}
												onChange={(event) =>
													update((current) => ({
														...current,
														categories: current.categories.map((entry, index) =>
															index === categoryIndex ? event.target.value : entry,
														),
													}))
												}
											/>
											{canRemoveCategory && (
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="size-7 shrink-0"
													aria-label={`Remove category ${category || categoryIndex + 1}`}
													onClick={() =>
														update((current) => ({
															...current,
															categories: current.categories.filter(
																(_, index) => index !== categoryIndex,
															),
															series: current.series.map((entry) => ({
																...entry,
																values: entry.values.filter((_, index) => index !== categoryIndex),
															})),
														}))
													}
												>
													<X className="size-3.5" />
												</Button>
											)}
										</div>
									</td>
									{draft.series.map((series, seriesIndex) => (
										<td key={series.id ?? `new-${seriesIndex}`}>
											<Input
												aria-label={`${series.name || `Series ${seriesIndex + 1}`} in ${category || `category ${categoryIndex + 1}`}`}
												inputMode="decimal"
												className="text-right tabular-nums"
												value={series.values[categoryIndex] ?? ""}
												onChange={(event) =>
													update((current) => ({
														...current,
														series: current.series.map((entry, index) =>
															index === seriesIndex
																? {
																		...entry,
																		values: entry.values.map((value, position) =>
																			position === categoryIndex ? event.target.value : value,
																		),
																	}
																: entry,
														),
													}))
												}
											/>
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					{canAddCategory && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="mt-1"
							onClick={() =>
								update((current) => ({
									...current,
									categories: [...current.categories, `Category ${current.categories.length + 1}`],
									series: current.series.map((entry) => ({
										...entry,
										values: [...entry.values, "0"],
									})),
								}))
							}
						>
							<Plus className="size-4" />
							Add category
						</Button>
					)}
				</div>
				<div className="grid grid-cols-[1fr_1fr_2fr] gap-3 text-sm">
					<div className="flex flex-col gap-1">
						<label htmlFor={`${id}-prefix`} className="text-muted-foreground">
							Prefix
						</label>
						<Input
							id={`${id}-prefix`}
							value={draft.prefix}
							maxLength={LIMITS.affix}
							placeholder="$"
							onChange={(event) =>
								update((current) => ({ ...current, prefix: event.target.value }))
							}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor={`${id}-suffix`} className="text-muted-foreground">
							Suffix
						</label>
						<Input
							id={`${id}-suffix`}
							value={draft.suffix}
							maxLength={LIMITS.affix}
							placeholder=" GW"
							onChange={(event) =>
								update((current) => ({ ...current, suffix: event.target.value }))
							}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor={`${id}-caption`} className="text-muted-foreground">
							Source note
						</label>
						<Input
							id={`${id}-caption`}
							value={draft.caption}
							maxLength={LIMITS.chartCaption}
							placeholder="Where the figures come from"
							onChange={(event) =>
								update((current) => ({ ...current, caption: event.target.value }))
							}
						/>
					</div>
				</div>
				{problem && (
					<p role="alert" className="text-sm text-red-400">
						{problem}
					</p>
				)}
				<DialogFooter>
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button type="button" onClick={save}>
						Save data
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
