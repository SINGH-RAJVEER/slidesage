import {
	addListItem,
	type BulletsNode,
	type Card,
	COVER_PALETTE,
	type ColumnsNode,
	type ContentNode,
	FEATURE_TEXT,
	featureSplit,
	type ImageNode,
	isWidget,
	type QuoteNode,
	removeListItem,
	STOCK_LIBRARIES,
	type StatNode,
	type StepsNode,
	setItemText,
	setNodeField,
	setNodeText,
	setPartField,
	syncTakeaway,
	type WidgetNode,
	widgetRows,
} from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { cn } from "@slidesage/ui/lib/utils";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import {
	AddItem,
	CardEditScope,
	type DocumentEdit,
	itemBounds,
	PlainField,
	RemoveItem,
	RichField,
	useEditing,
} from "./fields";
import type { CardTheme } from "./themes";
import { Widget } from "./Widgets";

export { CardEditScope, type DocumentEdit, RichTextView } from "./fields";

function nodesOf<T extends ContentNode["type"]>(card: Card, type: T) {
	return card.nodes.filter((node): node is Extract<ContentNode, { type: T }> => node.type === type);
}

function Heading({ card, theme, large }: { card: Card; theme: CardTheme; large?: boolean }) {
	const [heading] = nodesOf(card, "heading");
	if (!heading) return null;
	return (
		<h2
			data-node-id={heading.id}
			className={cn(
				"font-semibold leading-[1.1] tracking-tight text-balance",
				large
					? "text-[length:calc(5.4cqw*var(--fit,1))]"
					: "text-[length:calc(3.4cqw*var(--fit,1))]",
				theme.heading,
			)}
		>
			<RichField
				value={heading.text}
				label="Card heading"
				update={(document, value, cardId) =>
					syncTakeaway(setNodeText(document, cardId, heading.id, value), cardId)
				}
			/>
		</h2>
	);
}

function Paragraphs({ card, theme, large }: { card: Card; theme: CardTheme; large?: boolean }) {
	return (
		<>
			{nodesOf(card, "paragraph").map((paragraph) => (
				<p
					key={paragraph.id}
					data-node-id={paragraph.id}
					className={cn(
						"leading-snug text-pretty",
						large
							? "text-[length:calc(2.2cqw*var(--fit,1))]"
							: "text-[length:calc(1.8cqw*var(--fit,1))]",
						theme.body,
					)}
				>
					<RichField
						value={paragraph.text}
						label="Paragraph"
						update={(document, value, cardId) => setNodeText(document, cardId, paragraph.id, value)}
					/>
				</p>
			))}
		</>
	);
}

function Bullets({ node, theme }: { node: BulletsNode; theme: CardTheme }) {
	const editing = useEditing();
	const bounds = editing ? itemBounds(editing.card) : undefined;
	return (
		<div className="flex flex-col gap-[calc(1.2cqw*var(--fit,1))]">
			<ul data-node-id={node.id} className="flex flex-col gap-[calc(1.2cqw*var(--fit,1))]">
				{node.items.map((item) => (
					<li
						key={item.id}
						data-node-id={item.id}
						className={cn(
							"group/item flex gap-[calc(1.4cqw*var(--fit,1))] text-[length:calc(1.9cqw*var(--fit,1))] leading-snug",
							theme.body,
						)}
					>
						<span
							aria-hidden
							className={cn(
								"mt-[calc(0.9cqw*var(--fit,1))] size-[calc(0.7cqw*var(--fit,1))] shrink-0 rounded-full bg-current",
								theme.accent,
							)}
						/>
						<span className="min-w-0 flex-1">
							<RichField
								value={item.text}
								label="Bullet"
								update={(document, value, cardId) =>
									setItemText(document, cardId, node.id, item.id, value)
								}
							/>
						</span>
						<RemoveItem
							label="Remove bullet"
							visible={!!editing && !!bounds && node.items.length > bounds.min}
							onRemove={() =>
								editing?.edit((document) =>
									removeListItem(document, editing.card.id, node.id, item.id),
								)
							}
						/>
					</li>
				))}
			</ul>
			<AddItem
				label="Add bullet"
				theme={theme}
				visible={!!editing && !!bounds && node.items.length < bounds.max}
				onAdd={() => editing?.edit((document) => addListItem(document, editing.card.id, node.id))}
			/>
		</div>
	);
}

function Columns({ node, theme }: { node: ColumnsNode; theme: CardTheme }) {
	const editing = useEditing();
	const bounds = editing ? itemBounds(editing.card) : undefined;
	return (
		<div
			data-node-id={node.id}
			className="grid flex-1 gap-[calc(3cqw*var(--fit,1))]"
			style={{ gridTemplateColumns: `repeat(${node.columns.length}, minmax(0, 1fr))` }}
		>
			{node.columns.map((column, index) => (
				<div
					key={column.id}
					data-node-id={column.id}
					className={cn(
						"flex flex-col gap-[calc(1.4cqw*var(--fit,1))]",
						index > 0 && "border-l pl-[calc(3cqw*var(--fit,1))]",
						theme.rule,
					)}
				>
					<h3
						className={cn(
							"text-[length:calc(2.1cqw*var(--fit,1))] font-semibold font-[family-name:var(--card-heading-font)]",
							theme.accent,
						)}
					>
						<PlainField
							value={column.heading}
							label="Column heading"
							update={(document, value, cardId) =>
								setPartField(document, cardId, node.id, column.id, "heading", value)
							}
						/>
					</h3>
					<ul className="flex flex-col gap-[calc(1cqw*var(--fit,1))]">
						{column.items.map((item) => (
							<li
								key={item.id}
								data-node-id={item.id}
								className={cn(
									"group/item flex gap-[calc(1cqw*var(--fit,1))] text-[length:calc(1.7cqw*var(--fit,1))] leading-snug",
									theme.body,
								)}
							>
								<span className="min-w-0 flex-1">
									<RichField
										value={item.text}
										label="Column item"
										update={(document, value, cardId) =>
											setItemText(document, cardId, node.id, item.id, value)
										}
									/>
								</span>
								<RemoveItem
									label="Remove item"
									visible={!!editing && !!bounds && column.items.length > bounds.min}
									onRemove={() =>
										editing?.edit((document) =>
											removeListItem(document, editing.card.id, node.id, item.id),
										)
									}
								/>
							</li>
						))}
					</ul>
					<AddItem
						label="Add item"
						theme={theme}
						visible={!!editing && !!bounds && column.items.length < bounds.max}
						onAdd={() =>
							editing?.edit((document) =>
								addListItem(document, editing.card.id, node.id, { columnId: column.id }),
							)
						}
					/>
				</div>
			))}
		</div>
	);
}

function Steps({ node, theme }: { node: StepsNode; theme: CardTheme }) {
	const editing = useEditing();
	const bounds = editing ? itemBounds(editing.card) : undefined;
	return (
		<div className="flex flex-1 flex-col gap-[calc(1.6cqw*var(--fit,1))]">
			<ol
				data-node-id={node.id}
				className="grid flex-1 gap-[calc(2.4cqw*var(--fit,1))]"
				style={{ gridTemplateColumns: `repeat(${node.items.length}, minmax(0, 1fr))` }}
			>
				{node.items.map((step, index) => (
					<li
						key={step.id}
						data-node-id={step.id}
						className={cn(
							"group/item flex flex-col gap-[calc(1cqw*var(--fit,1))] border-t pt-[calc(1.6cqw*var(--fit,1))]",
							theme.rule,
						)}
					>
						<span
							className={cn(
								"flex text-[length:calc(1.6cqw*var(--fit,1))] font-semibold tabular-nums",
								theme.accent,
							)}
						>
							{String(index + 1).padStart(2, "0")}
							<RemoveItem
								label="Remove step"
								visible={!!editing && !!bounds && node.items.length > bounds.min}
								onRemove={() =>
									editing?.edit((document) =>
										removeListItem(document, editing.card.id, node.id, step.id),
									)
								}
							/>
						</span>
						<span
							className={cn(
								"text-[length:calc(1.9cqw*var(--fit,1))] font-semibold leading-tight",
								theme.heading,
							)}
						>
							<PlainField
								value={step.title}
								label="Step title"
								update={(document, value, cardId) =>
									setPartField(document, cardId, node.id, step.id, "title", value)
								}
							/>
						</span>
						{(step.detail || editing) && (
							<span
								className={cn("text-[length:calc(1.5cqw*var(--fit,1))] leading-snug", theme.body)}
							>
								<RichField
									value={step.detail ?? []}
									label="Step detail"
									update={(document, value, cardId) =>
										setPartField(document, cardId, node.id, step.id, "detail", value)
									}
								/>
							</span>
						)}
					</li>
				))}
			</ol>
			<AddItem
				label="Add step"
				theme={theme}
				visible={!!editing && !!bounds && node.items.length < bounds.max}
				onAdd={() => editing?.edit((document) => addListItem(document, editing.card.id, node.id))}
			/>
		</div>
	);
}

function Stats({ nodes, theme }: { nodes: StatNode[]; theme: CardTheme }) {
	return (
		<div
			className="grid gap-[calc(3cqw*var(--fit,1))]"
			style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}
		>
			{nodes.map((stat) => (
				<div
					key={stat.id}
					data-node-id={stat.id}
					className="flex flex-col gap-[calc(0.6cqw*var(--fit,1))]"
				>
					<span
						className={cn(
							"text-[length:calc(5cqw*var(--fit,1))] font-semibold leading-none tabular-nums font-[family-name:var(--card-heading-font)]",
							theme.accent,
						)}
					>
						<PlainField
							value={stat.value}
							label="Figure"
							update={(document, value, cardId) =>
								setNodeField(document, cardId, stat.id, { type: "stat", field: "value" }, value)
							}
						/>
					</span>
					<span className={cn("text-[length:calc(1.6cqw*var(--fit,1))] leading-snug", theme.body)}>
						<PlainField
							value={stat.label}
							label="Figure label"
							update={(document, value, cardId) =>
								setNodeField(document, cardId, stat.id, { type: "stat", field: "label" }, value)
							}
						/>
					</span>
				</div>
			))}
		</div>
	);
}

function Quote({ node, theme }: { node: QuoteNode; theme: CardTheme }) {
	const editing = useEditing();
	return (
		<figure data-node-id={node.id} className="flex flex-col gap-[calc(2cqw*var(--fit,1))]">
			<blockquote
				className={cn(
					"text-[length:calc(3.2cqw*var(--fit,1))] font-medium leading-[1.2] text-balance",
					theme.heading,
				)}
			>
				<span className={theme.accent}>“</span>
				<RichField
					value={node.text}
					label="Quotation"
					update={(document, value, cardId) => setNodeText(document, cardId, node.id, value)}
				/>
				<span className={theme.accent}>”</span>
			</blockquote>
			{(node.attribution || editing) && (
				<figcaption className={cn("text-[length:calc(1.7cqw*var(--fit,1))]", theme.muted)}>
					<PlainField
						value={node.attribution ?? ""}
						label="Attribution"
						update={(document, value, cardId) =>
							setNodeField(
								document,
								cardId,
								node.id,
								{ type: "quote", field: "attribution" },
								value,
							)
						}
					/>
				</figcaption>
			)}
		</figure>
	);
}

/** A paragraph, bullet list, or callout shown beside a chart or table. */
function FeatureText({ node, theme }: { node: ContentNode; theme: CardTheme }) {
	switch (node.type) {
		case "paragraph":
			return (
				<p
					data-node-id={node.id}
					className={cn(
						"text-[length:calc(1.8cqw*var(--fit,1))] leading-snug text-pretty",
						theme.body,
					)}
				>
					<RichField
						value={node.text}
						label="Paragraph"
						update={(document, value, cardId) => setNodeText(document, cardId, node.id, value)}
					/>
				</p>
			);
		case "bullets":
			return <Bullets node={node} theme={theme} />;
		case "callout":
			return <Widget node={node} theme={theme} />;
		default:
			return null;
	}
}

/**
 * A chart or table card: the widget takes its size's share of the width with
 * the text beside it, or sits above the text at full size. A chart fills the
 * height left over; a table keeps its own.
 */
function Feature({ card, theme }: { card: Card; theme: CardTheme }) {
	const widget = card.nodes.find((node): node is WidgetNode => node.type === card.layout);
	const text = card.nodes.filter((node) => node !== widget && FEATURE_TEXT.includes(node.type));
	if (!widget) return null;
	const split = featureSplit(widget.size, text.length > 0);
	const row = split.direction === "row";
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-[calc(2.6cqw*var(--fit,1))]">
			<Heading card={card} theme={theme} />
			<div
				className={cn(
					"flex min-h-0 flex-1 gap-[calc(3cqw*var(--fit,1))]",
					row ? "flex-row" : "flex-col",
				)}
			>
				<div
					className="flex min-h-0 min-w-0 flex-col"
					style={{
						flex: row ? `${split.share} 1 0` : widget.type === "chart" ? "1 1 0" : "none",
					}}
				>
					<Widget node={widget} theme={theme} />
				</div>
				{text.length > 0 && (
					<div
						className="flex min-w-0 flex-col justify-center gap-[calc(1.8cqw*var(--fit,1))]"
						style={{ flex: row ? `${1 - split.share} 1 0` : "none" }}
					>
						{text.map((node) => (
							<FeatureText key={node.id} node={node} theme={theme} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

/** Widgets packed into rows by size, the rows sharing the height left under the heading. */
function Dashboard({ card, theme }: { card: Card; theme: CardTheme }) {
	const rows = widgetRows(card.nodes.filter(isWidget));
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-[calc(2.6cqw*var(--fit,1))]">
			<Heading card={card} theme={theme} />
			<div className="flex min-h-0 flex-1 flex-col gap-[calc(2.4cqw*var(--fit,1))]">
				{rows.map((cells) => (
					<div
						key={cells.map((cell) => cell.widget.id).join()}
						className="flex min-h-0 flex-1 gap-[calc(3cqw*var(--fit,1))]"
					>
						{cells.map((cell) => (
							<div
								key={cell.widget.id}
								className="flex min-h-0 min-w-0 flex-col justify-center"
								style={{ flex: `${cell.width} 1 0` }}
							>
								<Widget node={cell.widget} theme={theme} />
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	);
}

function CardBody({ card, theme }: { card: Card; theme: CardTheme }) {
	switch (card.layout) {
		case "chart":
		case "table":
			return <Feature card={card} theme={theme} />;
		case "dashboard":
			return <Dashboard card={card} theme={theme} />;
		case "title":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[calc(2cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} large />
					<Paragraphs card={card} theme={theme} large />
				</div>
			);
		case "statement":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[calc(2.4cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} />
					<Paragraphs card={card} theme={theme} large />
				</div>
			);
		case "bullets":
			return (
				<div className="flex flex-1 flex-col gap-[calc(3cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "bullets").map((node) => (
						<Bullets key={node.id} node={node} theme={theme} />
					))}
					<Paragraphs card={card} theme={theme} />
				</div>
			);
		case "comparison":
			return (
				<div className="flex flex-1 flex-col gap-[calc(3cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "columns").map((node) => (
						<Columns key={node.id} node={node} theme={theme} />
					))}
				</div>
			);
		case "process":
			return (
				<div className="flex flex-1 flex-col gap-[calc(3.4cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "steps").map((node) => (
						<Steps key={node.id} node={node} theme={theme} />
					))}
				</div>
			);
		case "quote":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[calc(2.4cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "quote").map((node) => (
						<Quote key={node.id} node={node} theme={theme} />
					))}
				</div>
			);
		case "image-left":
		case "image-right":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[calc(2.4cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "bullets").map((node) => (
						<Bullets key={node.id} node={node} theme={theme} />
					))}
					<Paragraphs card={card} theme={theme} />
				</div>
			);
		case "cover":
			return (
				<div className="flex flex-1 flex-col justify-end gap-[calc(1.6cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} large />
					<Paragraphs card={card} theme={theme} large />
				</div>
			);
		case "stats":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[calc(3.4cqw*var(--fit,1))]">
					<Heading card={card} theme={theme} />
					<Stats nodes={nodesOf(card, "stat")} theme={theme} />
					<Paragraphs card={card} theme={theme} />
				</div>
			);
	}
}

/** Maps the drafter's source IDs (s1, s2, ...) to citation numbers and links. */
export function citationsFor(sources: Source[]) {
	return Object.fromEntries(
		sources.map((source, index) => [
			`s${index + 1}`,
			{ number: index + 1, url: source.url, title: source.title },
		]),
	);
}

/** What the server knows about an image a card shows. */
export interface CardAsset {
	mimeType: string;
	width: number;
	height: number;
	/** Set for a photo shown hotlinked from its library rather than stored. */
	url?: string;
	source?: {
		type?: string;
		provider?: string;
		photographer?: string;
		photographerUrl?: string;
		pageUrl?: string;
	};
}

export interface CardViewProps {
	card: Card;
	theme: CardTheme;
	/** One-based position, shown in the card's corner. */
	position: number;
	/** Maps a card's source IDs to their citation numbers and links. */
	sources?: Record<string, { number: number; url: string; title?: string }>;
	/** Stored images the document shows, keyed by asset ID. */
	assets?: Record<string, CardAsset>;
	/** Resolves an asset ID to the URL that serves it. */
	assetUrl?: (assetId: string) => string;
	/** Present while the deck is being edited; makes every text field editable. */
	edit?: DocumentEdit;
}

/** The theme a cover card's text uses over its photo, whatever the deck theme. */
const COVER_TEXT: CardTheme = {
	surface: "",
	heading: "text-white font-[family-name:var(--card-heading-font)]",
	body: "text-[color:var(--card-cover-body)]",
	muted: "text-[color:var(--card-cover-muted)]",
	accent: "text-white",
	rule: "border-white/20",
};

function CardImage({
	node,
	src,
	className,
}: {
	node: ImageNode;
	src?: string;
	className?: string;
}) {
	const focus = node.focus ?? { x: 0.5, y: 0.5 };
	if (!src) return null;
	return (
		<img
			data-node-id={node.id}
			src={src}
			alt={node.alt}
			loading="lazy"
			decoding="async"
			draggable={false}
			className={cn("h-full w-full", className)}
			style={{ objectFit: node.fit, objectPosition: `${focus.x * 100}% ${focus.y * 100}%` }}
		/>
	);
}

/** Photo credit in the form the stock provider asks for. */
function Attribution({ asset, className }: { asset?: CardAsset; className?: string }) {
	const source = asset?.source;
	if (source?.type !== "stock" || !source.photographer) return null;
	const library = STOCK_LIBRARIES[source.provider ?? ""];
	const provider = library?.name ?? source.provider;
	const providerUrl = library?.url ?? source.pageUrl;
	return (
		<span className={className}>
			Photo by{" "}
			{source.photographerUrl ? (
				<a
					href={source.photographerUrl}
					target="_blank"
					rel="noreferrer noopener"
					className="underline-offset-2 hover:underline"
				>
					{source.photographer}
				</a>
			) : (
				source.photographer
			)}{" "}
			on{" "}
			{providerUrl ? (
				<a
					href={providerUrl}
					target="_blank"
					rel="noreferrer noopener"
					className="underline-offset-2 hover:underline"
				>
					{provider}
				</a>
			) : (
				provider
			)}
		</span>
	);
}

/** Text never shrinks below this fraction of its designed size, as in PPTX export. */
export const MIN_TEXT_SCALE = 0.5;

/**
 * The largest text scale, at most 1 and at least `MIN_TEXT_SCALE`, at which
 * the content fits its box. Every content size is multiplied by `--fit`, so
 * the scale is found by trying values on the element and measuring.
 */
export function fitTextScale(target: HTMLElement, box: HTMLElement): number {
	const fits = (scale: number) => {
		target.style.setProperty("--fit", String(scale));
		return box.scrollHeight <= box.clientHeight + 1;
	};
	if (fits(1)) return 1;
	let low = MIN_TEXT_SCALE;
	let high = 1;
	for (let step = 0; step < 8; step++) {
		const middle = (low + high) / 2;
		if (fits(middle)) low = middle;
		else high = middle;
	}
	target.style.setProperty("--fit", String(low));
	return low;
}

/**
 * One card, always exactly 16:9, with text sized to the card rather than the
 * window. Content that needs more room than the slide has shrinks, text and
 * the space between items together, until it fits, the way PPTX export fits
 * it. `data-text-scale` records how far it shrank.
 */
export function CardView({
	card,
	theme,
	position,
	sources,
	assets,
	assetUrl,
	edit,
}: CardViewProps) {
	const cited = card.sourceIds.flatMap((id) => (sources?.[id] ? [sources[id]] : []));
	const articleRef = useRef<HTMLElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [textScale, setTextScale] = useState(1);
	const [image] = nodesOf(card, "image");
	const asset = image ? assets?.[image.assetId] : undefined;
	const imageSrc = image ? (asset?.url ?? assetUrl?.(image.assetId)) : undefined;
	const split = card.layout === "image-left" || card.layout === "image-right";
	const cover = card.layout === "cover";
	const textTheme = cover ? COVER_TEXT : theme;

	// Refit whenever the card changes, the slide is resized, or the content
	// grows or shrinks while it is edited.
	useLayoutEffect(() => {
		const article = articleRef.current;
		const content = contentRef.current;
		if (!article || !content) return undefined;
		const fit = () => setTextScale(fitTextScale(article, content));
		fit();
		let active = true;
		void document.fonts?.ready.then(() => {
			if (active) fit();
		});
		document.fonts?.addEventListener("loadingdone", fit);
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fit);
		observer?.observe(article);
		if (content.firstElementChild) observer?.observe(content.firstElementChild);
		return () => {
			active = false;
			observer?.disconnect();
			document.fonts?.removeEventListener("loadingdone", fit);
		};
	}, [card, theme]);

	const footer = (
		<footer
			className={cn("flex items-end justify-between gap-[2cqw] text-[1.1cqw]", textTheme.muted)}
		>
			<span className="flex flex-wrap gap-[0.8cqw]">
				{cited.map((source) => (
					<a
						key={source.number}
						href={source.url}
						target="_blank"
						rel="noreferrer noopener"
						title={source.title ?? source.url}
						className="underline-offset-2 hover:underline"
					>
						[{source.number}]
					</a>
				))}
				<Attribution asset={asset} />
			</span>
			<span className="tabular-nums">{position}</span>
		</footer>
	);

	return (
		<div className="@container w-full">
			<article
				ref={articleRef}
				style={
					{
						...theme.style,
						"--card-cover-body": COVER_PALETTE.body,
						"--card-cover-muted": COVER_PALETTE.muted,
					} as CSSProperties
				}
				data-card-id={card.id}
				data-layout={card.layout}
				data-text-scale={textScale < 1 ? textScale.toFixed(2) : undefined}
				aria-label={`Card ${position}: ${card.takeaway}`}
				className={cn(
					"relative flex h-[56.25cqw] w-full overflow-hidden rounded-[1.2cqw]",
					split ? (card.layout === "image-right" ? "flex-row-reverse" : "flex-row") : "flex-col",
					!split && "px-[6cqw] pt-[5cqw] pb-[2.2cqw]",
					theme.surface,
				)}
			>
				{cover && image && (
					<>
						<div className="absolute inset-0">
							<CardImage node={image} src={imageSrc} />
						</div>
						<div
							aria-hidden
							className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/5"
						/>
					</>
				)}
				{split && image && (
					<div className="relative w-1/2 shrink-0 self-stretch">
						<div className="absolute inset-0">
							<CardImage node={image} src={imageSrc} />
						</div>
					</div>
				)}
				<div
					className={cn(
						"relative flex min-h-0 flex-1 flex-col",
						split && "px-[5cqw] pt-[5cqw] pb-[2.2cqw]",
					)}
				>
					<div
						ref={contentRef}
						className="flex min-h-0 flex-1 flex-col overflow-hidden pb-[2.8cqw]"
					>
						<CardEditScope edit={edit} card={card}>
							<CardBody card={card} theme={textTheme} />
						</CardEditScope>
					</div>
					{footer}
				</div>
			</article>
		</div>
	);
}
