import {
	CHART_KINDS,
	type ChartKind,
	type ChartNode,
	type ContentNode,
	WIDGET_TYPES,
	type WidgetNode,
	type WidgetSize,
} from "./schema";
import { SERIES_SLOTS } from "./themes";

/**
 * Widget geometry shared by the browser card view and PPTX export, so both
 * place every widget in the same row at the same width.
 */

/** A widget's span on a twelve-column grid. */
export const SIZE_SPAN: Record<WidgetSize, number> = { small: 4, medium: 6, large: 8, full: 12 };
export const GRID_COLUMNS = 12;
/** The most widget rows a dashboard card holds. */
export const DASHBOARD_ROWS = 2;

export function isWidget(node: ContentNode): node is WidgetNode {
	return (WIDGET_TYPES as readonly string[]).includes(node.type);
}

export interface WidgetCell<T> {
	widget: T;
	/** The widget's share of its row's width, from 0 to 1. */
	width: number;
}

/**
 * Packs widgets into rows in order: a widget starts a new row when its span
 * would overflow the current one. Widths within a row are the widgets' spans
 * relative to each other, so a row is always filled edge to edge.
 */
export function widgetRows<T extends { size: WidgetSize }>(widgets: T[]): WidgetCell<T>[][] {
	const rows: T[][] = [];
	let used = GRID_COLUMNS;
	for (const widget of widgets) {
		const span = SIZE_SPAN[widget.size];
		if (used + span > GRID_COLUMNS) {
			rows.push([]);
			used = 0;
		}
		rows[rows.length - 1]?.push(widget);
		used += span;
	}
	return rows.map((row) => {
		const total = row.reduce((sum, widget) => sum + SIZE_SPAN[widget.size], 0);
		return row.map((widget) => ({ widget, width: SIZE_SPAN[widget.size] / total }));
	});
}

/** Nodes shown beside the chart of a chart card or the table of a table card. */
export const FEATURE_TEXT: readonly ContentNode["type"][] = ["paragraph", "bullets", "callout"];

/**
 * How a chart or table card places its widget beside its text. A full widget
 * sits above the text; any other size takes that share of the width with the
 * text beside it. Without text the widget fills the card.
 */
export function featureSplit(
	size: WidgetSize,
	hasText: boolean,
): { direction: "row" | "column"; share: number } {
	if (!hasText) return { direction: "column", share: 1 };
	if (size === "full") return { direction: "column", share: 1 };
	return { direction: "row", share: SIZE_SPAN[size] / GRID_COLUMNS };
}

export const PIE_KINDS: readonly ChartKind[] = ["pie", "donut"];

/** Explains why `chart` cannot be drawn as `kind`, or returns null when it can. */
export function chartKindMismatch(
	kind: ChartKind,
	chart: Pick<ChartNode, "categories" | "series">,
): string | null {
	if (PIE_KINDS.includes(kind)) {
		if (chart.series.length !== 1) return `a ${kind} chart shows exactly one series`;
		if (chart.categories.length > SERIES_SLOTS) {
			return `a ${kind} chart shows at most ${SERIES_SLOTS} slices`;
		}
		const values = chart.series[0]?.values ?? [];
		if (values.some((value) => value < 0)) return `a ${kind} chart cannot show negative values`;
		if (!values.some((value) => value > 0)) return `a ${kind} chart needs a value above zero`;
	}
	if (kind === "stacked-column" && chart.series.length < 2) {
		return "a stacked-column chart needs at least two series";
	}
	return null;
}

/** Chart kinds that can show the chart's data unchanged. */
export function compatibleChartKinds(chart: Pick<ChartNode, "categories" | "series">): ChartKind[] {
	return CHART_KINDS.filter((kind) => chartKindMismatch(kind, chart) === null);
}

/** Formats a chart value with its prefix and suffix, grouping thousands. */
export function formatChartValue(
	value: number,
	chart: Pick<ChartNode, "prefix" | "suffix">,
	locale = "en-US",
): string {
	const number = new Intl.NumberFormat(locale, {
		maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
	}).format(Math.abs(value));
	return `${value < 0 ? "−" : ""}${chart.prefix ?? ""}${number}${chart.suffix ?? ""}`;
}

/**
 * Evenly spaced axis ticks with round steps (1, 2, or 5 times a power of ten)
 * covering zero and every value.
 */
export function axisTicks(values: number[], count = 4): number[] {
	const low = Math.min(0, ...values);
	const high = Math.max(0, ...values);
	if (low === high) return [0, 1];
	const rough = (high - low) / count;
	const power = 10 ** Math.floor(Math.log10(rough));
	const step =
		[1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ??
		10 * power;
	const ticks: number[] = [];
	const end = Math.ceil(high / step) * step;
	for (let tick = Math.floor(low / step) * step; tick <= end + step / 2; tick += step) {
		ticks.push(Number(tick.toPrecision(12)));
	}
	return ticks;
}

/** Per-category totals of a stacked chart's positive and negative parts. */
export function stackedExtent(chart: Pick<ChartNode, "categories" | "series">): number[] {
	return chart.categories.flatMap((_, index) => {
		let positive = 0;
		let negative = 0;
		for (const series of chart.series) {
			const value = series.values[index] ?? 0;
			if (value >= 0) positive += value;
			else negative += value;
		}
		return [positive, negative];
	});
}
