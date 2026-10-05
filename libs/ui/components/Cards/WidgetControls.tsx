import {
	addTableColumn,
	CALLOUT_TONES,
	type CalloutTone,
	CHART_KINDS,
	type ChartKind,
	canRemoveWidget,
	compatibleChartKinds,
	compatibleSizes,
	FEATURE_TEXT,
	LIMITS,
	removeTableColumn,
	removeWidget,
	setCalloutTone,
	setChartKind,
	setWidgetSize,
	WIDGET_SIZES,
	type WidgetNode,
	type WidgetSize,
	type WidgetType,
} from "@slidesage/cards";
import { Button } from "@slidesage/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@slidesage/ui/components/dropdown-menu";
import { ChartColumn, Columns3, Info, Scaling, Table2, Trash2 } from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";
import { ChartDataDialog } from "./ChartDataDialog";
import { useEditing } from "./fields";

export const WIDGET_NAMES: Record<WidgetType, string> = {
	chart: "Chart",
	progress: "Meters",
	table: "Table",
	callout: "Callout",
};

export const CHART_KIND_NAMES: Record<ChartKind, string> = {
	column: "Column",
	bar: "Bar",
	"stacked-column": "Stacked column",
	line: "Line",
	area: "Area",
	pie: "Pie",
	donut: "Donut",
};

const SIZE_NAMES: Record<WidgetSize, string> = {
	small: "Small",
	medium: "Medium",
	large: "Large",
	full: "Full width",
};

const TONE_NAMES: Record<CalloutTone, string> = {
	note: "Note",
	positive: "Positive",
	caution: "Caution",
};

const triggerClass = "size-7 text-white/70 hover:bg-white/10 hover:text-white";

function Menu({
	label,
	icon: Icon,
	children,
}: {
	label: string;
	icon: ComponentType<{ className?: string }>;
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={label}
					className={triggerClass}
				>
					<Icon className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>{label}</DropdownMenuLabel>
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Controls for one widget while the deck is edited: a chart's kind and data,
 * a callout's tone, a table's columns, the widget's size where it changes the
 * layout, and removal where the layout allows it. They appear over the
 * widget on hover or keyboard focus.
 */
export function WidgetControls({ node }: { node: WidgetNode }) {
	const editing = useEditing();
	const [dataOpen, setDataOpen] = useState(false);
	if (!editing) return null;
	const { edit, card } = editing;
	const feature = (card.layout === "chart" || card.layout === "table") && node.type === card.layout;
	const hasText = card.nodes.some((entry) => entry !== node && FEATURE_TEXT.includes(entry.type));
	// Size sets a dashboard widget's share of its row, or a chart or table's share beside text.
	const sizes =
		card.layout === "dashboard" || (feature && hasText) ? compatibleSizes(card, node.id) : [];
	const removable = canRemoveWidget(card, node.id);

	return (
		<div
			role="toolbar"
			aria-label={`${WIDGET_NAMES[node.type]} controls`}
			className="absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded-md border border-white/10 bg-neutral-950/90 p-0.5 opacity-0 shadow-lg transition-opacity focus-within:opacity-100 group-hover/widget:opacity-100"
		>
			{node.type === "chart" && (
				<>
					<Menu label="Chart type" icon={ChartColumn}>
						<DropdownMenuRadioGroup
							value={node.kind}
							onValueChange={(kind) =>
								edit((document) => setChartKind(document, card.id, node.id, kind as ChartKind))
							}
						>
							{CHART_KINDS.map((kind) => (
								<DropdownMenuRadioItem
									key={kind}
									value={kind}
									disabled={!compatibleChartKinds(node).includes(kind)}
								>
									{CHART_KIND_NAMES[kind]}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</Menu>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Edit chart data"
						className={triggerClass}
						onClick={() => setDataOpen(true)}
					>
						<Table2 className="size-3.5" />
					</Button>
					<ChartDataDialog
						open={dataOpen}
						onOpenChange={setDataOpen}
						card={card}
						node={node}
						edit={edit}
					/>
				</>
			)}
			{node.type === "callout" && (
				<Menu label="Callout tone" icon={Info}>
					<DropdownMenuRadioGroup
						value={node.tone}
						onValueChange={(tone) =>
							edit((document) => setCalloutTone(document, card.id, node.id, tone as CalloutTone))
						}
					>
						{CALLOUT_TONES.map((tone) => (
							<DropdownMenuRadioItem key={tone} value={tone}>
								{TONE_NAMES[tone]}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</Menu>
			)}
			{node.type === "table" && (
				<Menu label="Table columns" icon={Columns3}>
					<DropdownMenuItem
						disabled={node.columns.length >= LIMITS.tableColumns.max}
						onSelect={() => edit((document) => addTableColumn(document, card.id, node.id))}
					>
						Add column
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{node.columns.map((heading, column) => (
						<DropdownMenuItem
							key={column}
							disabled={node.columns.length <= LIMITS.tableColumns.min}
							onSelect={() =>
								edit((document) => removeTableColumn(document, card.id, node.id, column))
							}
						>
							Remove “{heading}”
						</DropdownMenuItem>
					))}
				</Menu>
			)}
			{sizes.length > 0 && (
				<Menu label="Widget size" icon={Scaling}>
					<DropdownMenuRadioGroup
						value={node.size}
						onValueChange={(size) =>
							edit((document) => setWidgetSize(document, card.id, node.id, size as WidgetSize))
						}
					>
						{WIDGET_SIZES.map((size) => (
							<DropdownMenuRadioItem key={size} value={size} disabled={!sizes.includes(size)}>
								{SIZE_NAMES[size]}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</Menu>
			)}
			{removable && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={`Remove ${WIDGET_NAMES[node.type].toLowerCase()}`}
					className={triggerClass}
					onClick={() => edit((document) => removeWidget(document, card.id, node.id))}
				>
					<Trash2 className="size-3.5" />
				</Button>
			)}
		</div>
	);
}
