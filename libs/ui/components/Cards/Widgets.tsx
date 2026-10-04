import {
	addListItem,
	axisTicks,
	type CalloutNode,
	type ChartNode,
	formatChartValue,
	LIMITS,
	PIE_KINDS,
	type ProgressNode,
	removeListItem,
	setMeter,
	setNodeText,
	setTableCell,
	stackedExtent,
	type TableNode,
	type WidgetNode,
} from "@slidesage/cards";
import { cn } from "@slidesage/ui/lib/utils";
import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { AddItem, PlainField, RemoveItem, RichField, useEditing } from "./fields";
import type { CardTheme } from "./themes";
import { WidgetControls } from "./WidgetControls";

/**
 * Data widgets drawn from the theme's tokens. Marks take the series colors;
 * every label and value stays in the text colors, so a light series hue never
 * has to be legible as text. Charts are SVG sized to their box in pixels, with
 * text sized to the card like the rest of it.
 */

const seriesColor = (index: number) => `var(--card-series-${index + 1})`;

/**
 * Measures an element's box and font, re-measuring when it resizes and when
 * web fonts finish loading, since labels measured in a fallback face misfit.
 */
function useBox<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [box, setBox] = useState({ width: 0, height: 0, font: 0, family: "", fonts: 0 });
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return undefined;
		const measure = () => {
			const style = getComputedStyle(element);
			const font = Number.parseFloat(style.fontSize) || 0;
			setBox((current) => {
				const next = {
					width: element.clientWidth,
					height: element.clientHeight,
					font,
					family: style.fontFamily ?? "",
					fonts: current.fonts,
				};
				return current.width === next.width &&
					current.height === next.height &&
					current.font === next.font &&
					current.family === next.family
					? current
					: next;
			});
		};
		const fontsLoaded = () => setBox((current) => ({ ...current, fonts: current.fonts + 1 }));
		measure();
		// Test DOMs may lack a font set, so each part of it is optional.
		const fonts: Partial<FontFaceSet> | undefined =
			typeof document !== "undefined" ? document.fonts : undefined;
		let active = true;
		fonts?.ready?.then(() => {
			if (active) fontsLoaded();
		});
		fonts?.addEventListener?.("loadingdone", fontsLoaded);
		const observer =
			typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
		observer?.observe(element);
		return () => {
			active = false;
			fonts?.removeEventListener?.("loadingdone", fontsLoaded);
			observer?.disconnect();
		};
	}, []);
	return [ref, box] as const;
}

let canvas: CanvasRenderingContext2D | null | undefined;

/**
 * Measures labels in the chart's own font, so axis gutters fit wide faces.
 * Where there is no canvas to measure with, it estimates from the length.
 */
function labelMeasure(font: number, family: string): (label: string) => number {
	if (canvas === undefined) {
		try {
			canvas = document.createElement("canvas").getContext("2d");
		} catch {
			canvas = null;
		}
	}
	const context = canvas;
	if (!context || !family) return (label) => label.length * font * 0.56;
	// Value labels are semibold, so measure every label at that weight.
	const shorthand = `600 ${font}px ${family}`;
	return (label) => {
		context.font = shorthand;
		return context.measureText(label).width;
	};
}

/** The label if it fits `width` pixels, or as much as fits with an ellipsis. */
function fitLabel(label: string, width: number, measure: (label: string) => number): string {
	if (measure(label) <= width) return label;
	for (let length = label.length - 1; length >= 1; length--) {
		const cut = `${label.slice(0, length)}…`;
		if (measure(cut) <= width) return cut;
	}
	return "";
}

/** A bar from its baseline to its data end, rounded only at the data end. */
function barPath(
	orientation: "vertical" | "horizontal",
	across: number,
	thickness: number,
	base: number,
	end: number,
	radius: number,
): string {
	const length = Math.abs(end - base);
	const r = Math.min(radius, thickness / 2, length);
	const sign = end < base ? -1 : 1;
	const a = across;
	const b = across + thickness;
	if (orientation === "vertical") {
		return `M${a},${base} V${end - sign * r} Q${a},${end} ${a + r},${end} H${b - r} Q${b},${end} ${b},${end - sign * r} V${base} Z`;
	}
	return `M${base},${a} H${end - sign * r} Q${end},${a} ${end},${a + r} V${b - r} Q${end},${b} ${end - sign * r},${b} H${base} Z`;
}

interface PlotProps {
	node: ChartNode;
	width: number;
	height: number;
	font: number;
	measure: (label: string) => number;
}

/** Labels every bar only when there are few enough to read. */
const labelsBars = (node: ChartNode) => node.series.length === 1 && node.categories.length <= 8;

function ColumnPlot({ node, width, height, font, measure }: PlotProps) {
	const stacked = node.kind === "stacked-column";
	const lines = node.kind === "line" || node.kind === "area";
	const values = stacked ? stackedExtent(node) : node.series.flatMap((series) => series.values);
	const ticks = axisTicks(values);
	const low = ticks[0] ?? 0;
	const high = ticks.at(-1) ?? 1;
	const tickLabels = ticks.map((tick) => formatChartValue(tick, node));
	const left = Math.max(...tickLabels.map((label) => measure(label))) + font * 0.7;
	const top = font * 1.4;
	const bottom = font * 1.9;
	const right = font * 0.6;
	const plotWidth = Math.max(0, width - left - right);
	const plotHeight = Math.max(0, height - top - bottom);
	const y = (value: number) => top + ((high - value) / (high - low)) * plotHeight;
	const band = plotWidth / node.categories.length;
	const center = (index: number) => left + band * (index + 0.5);
	const zero = y(0);
	const every = Math.max(1, Math.ceil((font * 3) / band));

	let marks: ReactNode;
	if (lines) {
		const stroke = Math.max(2, font * 0.16);
		const dot = Math.max(4, font * 0.3);
		marks = node.series.map((series, seriesIndex) => {
			const points = series.values.map((value, index) => [center(index), y(value)] as const);
			const path = points.map(([px, py], index) => `${index ? "L" : "M"}${px},${py}`).join(" ");
			const color = seriesColor(seriesIndex);
			const last = points.at(-1);
			return (
				<g key={series.id}>
					{node.kind === "area" && (
						<path
							d={`${path} L${points.at(-1)?.[0]},${zero} L${points[0]?.[0]},${zero} Z`}
							fill={color}
							fillOpacity={0.14}
						/>
					)}
					<path
						d={path}
						fill="none"
						stroke={color}
						strokeWidth={stroke}
						strokeLinejoin="round"
						strokeLinecap="round"
					/>
					{points.map(([px, py], index) => (
						<circle
							key={node.categories[index]}
							cx={px}
							cy={py}
							r={dot}
							fill={color}
							stroke="var(--card-surface)"
							strokeWidth={2}
						>
							<title>
								{`${node.categories[index]} · ${series.name}: ${formatChartValue(series.values[index] ?? 0, node)}`}
							</title>
						</circle>
					))}
					{node.series.length === 1 && last && (
						<text
							x={last[0]}
							y={last[1] - dot - font * 0.4}
							textAnchor="middle"
							fill="var(--card-heading)"
							fontWeight={600}
						>
							{formatChartValue(series.values.at(-1) ?? 0, node)}
						</text>
					)}
				</g>
			);
		});
	} else {
		const count = stacked ? 1 : node.series.length;
		const gap = 2;
		const group = Math.min(band * 0.72, count * font * 2.8);
		const thickness = (group - gap * (count - 1)) / count;
		const radius = font * 0.25;
		marks = node.categories.map((category, index) => {
			const start = center(index) - group / 2;
			let positive = 0;
			let negative = 0;
			const bars = node.series.map((series, seriesIndex) => {
				const value = series.values[index] ?? 0;
				let base = 0;
				if (stacked) {
					base = value >= 0 ? positive : negative;
					if (value >= 0) positive += value;
					else negative += value;
				}
				const x = stacked ? start : start + seriesIndex * (thickness + gap);
				const outermost =
					!stacked ||
					node.series
						.slice(seriesIndex + 1)
						.every((later) => Math.sign(later.values[index] ?? 0) !== Math.sign(value));
				return (
					<path
						key={series.id}
						d={barPath("vertical", x, thickness, y(base), y(base + value), outermost ? radius : 0)}
						fill={seriesColor(seriesIndex)}
						stroke={stacked ? "var(--card-surface)" : undefined}
						strokeWidth={stacked ? 2 : undefined}
					>
						<title>{`${category} · ${series.name}: ${formatChartValue(value, node)}`}</title>
					</path>
				);
			});
			const total = stacked ? positive + negative : (node.series[0]?.values[index] ?? 0);
			const labelled = stacked ? node.categories.length <= 8 : labelsBars(node);
			const end = stacked ? (total >= 0 ? positive : negative) : total;
			return (
				<g key={category}>
					{bars}
					{labelled && (
						<text
							x={center(index)}
							y={end >= 0 ? y(end) - font * 0.45 : y(end) + font * 1.1}
							textAnchor="middle"
							fill="var(--card-heading)"
							fontWeight={600}
						>
							{formatChartValue(total, node)}
						</text>
					)}
				</g>
			);
		});
	}

	return (
		<>
			{ticks.map((tick, index) => (
				<g key={tick}>
					<line
						x1={left}
						x2={width - right}
						y1={y(tick)}
						y2={y(tick)}
						stroke={tick === 0 ? "var(--card-muted)" : "var(--card-rule)"}
						strokeOpacity={tick === 0 ? 0.6 : 1}
						strokeWidth={1}
					/>
					<text
						x={left - font * 0.5}
						y={y(tick)}
						textAnchor="end"
						dominantBaseline="middle"
						fill="var(--card-muted)"
					>
						{tickLabels[index]}
					</text>
				</g>
			))}
			{marks}
			{node.categories.map((category, index) =>
				index % every === 0 ? (
					<text
						key={category}
						x={center(index)}
						y={top + plotHeight + font * 1.35}
						textAnchor="middle"
						fill="var(--card-muted)"
					>
						{fitLabel(category, band * every - font * 0.4, measure)}
					</text>
				) : null,
			)}
		</>
	);
}

function BarPlot({ node, width, height, font, measure }: PlotProps) {
	const ticks = axisTicks(node.series.flatMap((series) => series.values));
	const low = ticks[0] ?? 0;
	const high = ticks.at(-1) ?? 1;
	const labelled = labelsBars(node);
	const valueRoom = labelled
		? Math.max(
				...(node.series[0]?.values ?? []).map((value) => measure(formatChartValue(value, node))),
			) +
			font * 0.6
		: font * 0.6;
	const left = Math.min(
		width * 0.34,
		Math.max(...node.categories.map((category) => measure(category))) + font * 0.8,
	);
	const top = font * 0.4;
	const bottom = labelled ? font * 0.4 : font * 1.9;
	const plotWidth = Math.max(0, width - left - valueRoom);
	const plotHeight = Math.max(0, height - top - bottom);
	const x = (value: number) => left + ((value - low) / (high - low)) * plotWidth;
	const band = plotHeight / node.categories.length;
	const count = node.series.length;
	const gap = 2;
	const group = Math.min(band * 0.72, count * font * 2.2);
	const thickness = (group - gap * (count - 1)) / count;
	return (
		<>
			{!labelled &&
				ticks.map((tick) => (
					<g key={tick}>
						<line
							x1={x(tick)}
							x2={x(tick)}
							y1={top}
							y2={top + plotHeight}
							stroke={tick === 0 ? "var(--card-muted)" : "var(--card-rule)"}
							strokeOpacity={tick === 0 ? 0.6 : 1}
						/>
						<text x={x(tick)} y={height - font * 0.5} textAnchor="middle" fill="var(--card-muted)">
							{formatChartValue(tick, node)}
						</text>
					</g>
				))}
			{node.categories.map((category, index) => {
				const middle = top + band * (index + 0.5);
				const start = middle - group / 2;
				return (
					<g key={category}>
						<text
							x={left - font * 0.6}
							y={middle}
							textAnchor="end"
							dominantBaseline="middle"
							fill="var(--card-body)"
						>
							{fitLabel(category, left - font * 0.8, measure)}
						</text>
						{node.series.map((series, seriesIndex) => {
							const value = series.values[index] ?? 0;
							return (
								<path
									key={series.id}
									d={barPath(
										"horizontal",
										start + seriesIndex * (thickness + gap),
										thickness,
										x(0),
										x(value),
										font * 0.25,
									)}
									fill={seriesColor(seriesIndex)}
								>
									<title>{`${category} · ${series.name}: ${formatChartValue(value, node)}`}</title>
								</path>
							);
						})}
						{labelled && (
							<text
								x={x(node.series[0]?.values[index] ?? 0) + font * 0.4}
								y={middle}
								dominantBaseline="middle"
								fill="var(--card-heading)"
								fontWeight={600}
							>
								{formatChartValue(node.series[0]?.values[index] ?? 0, node)}
							</text>
						)}
					</g>
				);
			})}
		</>
	);
}

function PiePlot({ node, width, height, font }: PlotProps) {
	const values = node.series[0]?.values ?? [];
	const total = values.reduce((sum, value) => sum + value, 0);
	const radius = Math.max(0, Math.min(width, height) / 2 - 2);
	const inner = node.kind === "donut" ? radius * 0.62 : 0;
	const cx = width / 2;
	const cy = height / 2;
	const point = (angle: number, r: number) =>
		[cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
	let angle = -Math.PI / 2;
	const slices = values.map((value, index) => {
		const sweep = total > 0 ? (value / total) * Math.PI * 2 : 0;
		const start = angle;
		angle += sweep;
		const large = sweep > Math.PI ? 1 : 0;
		const category = node.categories[index] ?? "";
		const title = `${category}: ${formatChartValue(value, node)}`;
		if (sweep >= Math.PI * 2 - 1e-6) {
			return (
				<circle
					key={category}
					cx={cx}
					cy={cy}
					r={(radius + inner) / 2}
					fill="none"
					stroke={seriesColor(index)}
					strokeWidth={radius - inner}
				>
					<title>{title}</title>
				</circle>
			);
		}
		const [x1, y1] = point(start, radius);
		const [x2, y2] = point(angle, radius);
		const [x3, y3] = point(angle, inner);
		const [x4, y4] = point(start, inner);
		const d = inner
			? `M${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`
			: `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z`;
		return (
			<path
				key={category}
				d={d}
				fill={seriesColor(index)}
				stroke="var(--card-surface)"
				strokeWidth={2}
				strokeLinejoin="round"
			>
				<title>{title}</title>
			</path>
		);
	});
	return (
		<>
			{slices}
			{inner > font * 2 && (
				<text
					x={cx}
					y={cy}
					textAnchor="middle"
					dominantBaseline="middle"
					fill="var(--card-heading)"
					fontWeight={600}
					fontSize={Math.min(font * 2, inner * 0.5)}
					style={{ fontFamily: "var(--card-heading-font)" }}
				>
					{formatChartValue(total, node)}
				</text>
			)}
		</>
	);
}

function Plot({ node }: { node: ChartNode }) {
	const [ref, box] = useBox<HTMLDivElement>();
	const ready = box.width > 0 && box.height > 0 && box.font > 0;
	const props = {
		node,
		width: box.width,
		height: box.height,
		font: box.font,
		measure: labelMeasure(box.font, box.family),
	};
	return (
		<div ref={ref} className="relative min-h-0 min-w-0 flex-1">
			{ready && (
				<svg
					aria-hidden="true"
					width={box.width}
					height={box.height}
					className="absolute inset-0 overflow-visible"
					fontSize={box.font}
				>
					{PIE_KINDS.includes(node.kind) ? (
						<PiePlot {...props} />
					) : node.kind === "bar" ? (
						<BarPlot {...props} />
					) : (
						<ColumnPlot {...props} />
					)}
				</svg>
			)}
		</div>
	);
}

function Swatch({ index, line }: { index: number; line?: boolean }) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-block shrink-0",
				line
					? "h-[calc(0.25cqw*var(--fit,1))] w-[calc(1.4cqw*var(--fit,1))] rounded-full"
					: "size-[calc(0.9cqw*var(--fit,1))] rounded-[calc(0.2cqw*var(--fit,1))]",
			)}
			style={{ background: seriesColor(index) }}
		/>
	);
}

/** The chart's numbers as a table for assistive technology. */
function DataTable({ node }: { node: ChartNode }) {
	return (
		<table className="sr-only">
			<thead>
				<tr>
					<th scope="col">Category</th>
					{node.series.map((series) => (
						<th key={series.id} scope="col">
							{series.name}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{node.categories.map((category, index) => (
					<tr key={category}>
						<th scope="row">{category}</th>
						{node.series.map((series) => (
							<td key={series.id}>{formatChartValue(series.values[index] ?? 0, node)}</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

const KIND_NAMES: Record<ChartNode["kind"], string> = {
	column: "Column chart",
	bar: "Bar chart",
	"stacked-column": "Stacked column chart",
	line: "Line chart",
	area: "Area chart",
	pie: "Pie chart",
	donut: "Donut chart",
};

export function Chart({ node, theme }: { node: ChartNode; theme: CardTheme }) {
	const pie = PIE_KINDS.includes(node.kind);
	const line = node.kind === "line" || node.kind === "area";
	const values = node.series[0]?.values ?? [];
	const total = values.reduce((sum, value) => sum + value, 0);
	return (
		<figure
			data-node-id={node.id}
			aria-label={`${KIND_NAMES[node.kind]} of ${node.series.map((series) => series.name).join(", ")}`}
			className="flex min-h-[calc(12cqw*var(--fit,1))] min-w-0 flex-1 flex-col gap-[calc(1cqw*var(--fit,1))]"
		>
			{!pie && node.series.length > 1 && (
				<ul
					className={cn(
						"flex flex-wrap gap-x-[calc(2cqw*var(--fit,1))] gap-y-[calc(0.5cqw*var(--fit,1))] text-[length:calc(1.3cqw*var(--fit,1))]",
						theme.body,
					)}
				>
					{node.series.map((series, index) => (
						<li key={series.id} className="flex items-center gap-[calc(0.6cqw*var(--fit,1))]">
							<Swatch index={index} line={line} />
							{series.name}
						</li>
					))}
				</ul>
			)}
			<div className="flex min-h-0 flex-1 gap-[calc(2.4cqw*var(--fit,1))] text-[length:calc(1.25cqw*var(--fit,1))]">
				<Plot node={node} />
				{pie && (
					<ul
						className={cn(
							"flex max-w-[50%] flex-col justify-center gap-[calc(0.8cqw*var(--fit,1))] text-[length:calc(1.4cqw*var(--fit,1))]",
							theme.body,
						)}
					>
						{node.categories.map((category, index) => {
							const value = formatChartValue(values[index] ?? 0, node);
							const share = total > 0 ? `${Math.round(((values[index] ?? 0) / total) * 100)}%` : "";
							return (
								<li key={category} className="flex items-center gap-[calc(0.8cqw*var(--fit,1))]">
									<Swatch index={index} />
									<span className="min-w-0 flex-1 truncate">{category}</span>
									<span className={cn("tabular-nums font-semibold", theme.heading)}>{value}</span>
									{/* Values that are already percentages need no second share. */}
									{share !== value && (
										<span className={cn("w-[4ch] text-right tabular-nums", theme.muted)}>
											{share}
										</span>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
			{node.caption && (
				<figcaption className={cn("text-[length:calc(1.1cqw*var(--fit,1))]", theme.muted)}>
					{node.caption}
				</figcaption>
			)}
			<DataTable node={node} />
		</figure>
	);
}

export function Progress({ node, theme }: { node: ProgressNode; theme: CardTheme }) {
	const editing = useEditing();
	return (
		<div
			data-node-id={node.id}
			className="flex min-w-0 flex-col justify-center gap-[calc(1.6cqw*var(--fit,1))]"
		>
			{node.items.map((meter) => (
				<div
					key={meter.id}
					data-node-id={meter.id}
					className="group/item flex flex-col gap-[calc(0.6cqw*var(--fit,1))]"
				>
					<div
						className={cn(
							"flex items-baseline gap-[calc(1cqw*var(--fit,1))] text-[length:calc(1.6cqw*var(--fit,1))] leading-snug",
							theme.body,
						)}
					>
						<span className="min-w-0 flex-1">
							<PlainField
								value={meter.label}
								label="Meter label"
								update={(document, value, cardId) =>
									setMeter(document, cardId, node.id, meter.id, { label: value })
								}
							/>
						</span>
						<span
							className={cn(
								"font-semibold tabular-nums font-[family-name:var(--card-heading-font)]",
								theme.heading,
							)}
						>
							<PlainField
								value={String(meter.value)}
								label="Meter percentage"
								update={(document, value, cardId) =>
									setMeter(document, cardId, node.id, meter.id, {
										value: Number(value.replace(/[^\d.]/g, "")),
									})
								}
							/>
							%
						</span>
						<RemoveItem
							label="Remove meter"
							visible={!!editing && node.items.length > LIMITS.meters.min}
							onRemove={() =>
								editing?.edit((document) =>
									removeListItem(document, editing.card.id, node.id, meter.id),
								)
							}
						/>
					</div>
					<meter className="sr-only" aria-label={meter.label} min={0} max={100} value={meter.value}>
						{meter.value}%
					</meter>
					<div
						aria-hidden
						className="h-[calc(0.8cqw*var(--fit,1))] overflow-hidden rounded-full bg-[color:var(--card-rule)]"
					>
						<div
							className="h-full rounded-full"
							style={{ width: `${meter.value}%`, background: seriesColor(0) }}
						/>
					</div>
				</div>
			))}
			<AddItem
				label="Add meter"
				theme={theme}
				visible={!!editing && node.items.length < LIMITS.meters.max}
				onAdd={() => editing?.edit((document) => addListItem(document, editing.card.id, node.id))}
			/>
		</div>
	);
}

const NUMERIC_CELL = /^[-+−]?[$€£¥₹]?\s?[\d.,]+\s?(%|[A-Za-z]{1,3})?$/;

export function Table({ node, theme }: { node: TableNode; theme: CardTheme }) {
	const editing = useEditing();
	// A column whose filled cells are all figures aligns right, so digits line up.
	const numeric = node.columns.map((_, column) => {
		const cells = node.rows.map((row) => row.cells[column] ?? "").filter(Boolean);
		return cells.length > 0 && cells.every((cell) => NUMERIC_CELL.test(cell.trim()));
	});
	return (
		<div className="flex min-w-0 flex-col gap-[calc(1cqw*var(--fit,1))]">
			<table
				data-node-id={node.id}
				className={cn(
					"w-full border-collapse text-[length:calc(1.5cqw*var(--fit,1))] leading-snug",
					theme.body,
				)}
			>
				<thead>
					<tr className={cn("border-b-2", theme.rule)}>
						{node.columns.map((heading, column) => (
							<th
								key={column}
								scope="col"
								className={cn(
									"px-[calc(1cqw*var(--fit,1))] py-[calc(0.8cqw*var(--fit,1))] text-left font-semibold font-[family-name:var(--card-heading-font)]",
									numeric[column] && "text-right",
									theme.heading,
								)}
							>
								<PlainField
									value={heading}
									label="Column heading"
									update={(document, value, cardId) =>
										setTableCell(document, cardId, node.id, null, column, value)
									}
								/>
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{node.rows.map((row) => (
						<tr
							key={row.id}
							data-node-id={row.id}
							className={cn("group/item border-b", theme.rule)}
						>
							{row.cells.map((cell, column) => (
								<td
									key={column}
									className={cn(
										"px-[calc(1cqw*var(--fit,1))] py-[calc(0.7cqw*var(--fit,1))] align-top",
										numeric[column] && "text-right tabular-nums",
									)}
								>
									<span className="flex items-start gap-[calc(0.6cqw*var(--fit,1))]">
										<span className="min-w-0 flex-1">
											<PlainField
												value={cell}
												label="Table cell"
												update={(document, value, cardId) =>
													setTableCell(document, cardId, node.id, row.id, column, value)
												}
											/>
										</span>
										{column === row.cells.length - 1 && (
											<RemoveItem
												label="Remove row"
												visible={!!editing && node.rows.length > LIMITS.tableRows.min}
												onRemove={() =>
													editing?.edit((document) =>
														removeListItem(document, editing.card.id, node.id, row.id),
													)
												}
											/>
										)}
									</span>
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			<AddItem
				label="Add row"
				theme={theme}
				visible={!!editing && node.rows.length < LIMITS.tableRows.max}
				onAdd={() => editing?.edit((document) => addListItem(document, editing.card.id, node.id))}
			/>
		</div>
	);
}

const TONES = {
	note: { label: "Note", icon: Info, color: "var(--card-accent)" },
	positive: { label: "Positive", icon: CircleCheck, color: "var(--card-positive)" },
	caution: { label: "Caution", icon: TriangleAlert, color: "var(--card-caution)" },
} as const;

export function Callout({ node, theme }: { node: CalloutNode; theme: CardTheme }) {
	const tone = TONES[node.tone];
	const Icon = tone.icon;
	return (
		<aside
			data-node-id={node.id}
			aria-label={tone.label}
			className="flex min-w-0 gap-[calc(1.2cqw*var(--fit,1))] border-l-[length:calc(0.35cqw*var(--fit,1))] py-[calc(0.3cqw*var(--fit,1))] pl-[calc(1.6cqw*var(--fit,1))]"
			style={{ borderColor: tone.color }}
		>
			<Icon
				aria-hidden
				className="mt-[calc(0.15cqw*var(--fit,1))] size-[calc(2cqw*var(--fit,1))] shrink-0"
				style={{ color: tone.color }}
			/>
			<p
				className={cn(
					"text-[length:calc(1.7cqw*var(--fit,1))] leading-snug text-pretty",
					theme.body,
				)}
			>
				<RichField
					value={node.text}
					label="Callout"
					update={(document, value, cardId) => setNodeText(document, cardId, node.id, value)}
				/>
			</p>
		</aside>
	);
}

function WidgetContent({ node, theme }: { node: WidgetNode; theme: CardTheme }) {
	switch (node.type) {
		case "chart":
			return <Chart node={node} theme={theme} />;
		case "progress":
			return <Progress node={node} theme={theme} />;
		case "table":
			return <Table node={node} theme={theme} />;
		case "callout":
			return <Callout node={node} theme={theme} />;
	}
}

/** A widget and, while editing, its controls. A chart grows to fill its cell; the rest keep their height. */
export function Widget({ node, theme }: { node: WidgetNode; theme: CardTheme }) {
	return (
		<div
			className={cn(
				"group/widget relative flex min-w-0 flex-col",
				node.type === "chart" && "min-h-0 flex-1",
			)}
		>
			<WidgetContent node={node} theme={theme} />
			<WidgetControls node={node} />
		</div>
	);
}
