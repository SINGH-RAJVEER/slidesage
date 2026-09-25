import type {
	BulletsNode,
	Card,
	ColumnsNode,
	ContentNode,
	QuoteNode,
	RichText,
	StatNode,
	StepsNode,
} from "@slidesage/cards";
import { cn } from "@slidesage/ui/lib/utils";
import { useLayoutEffect, useRef, useState } from "react";
import type { CardTheme } from "./themes";

export function RichTextView({ text }: { text: RichText }) {
	return (
		<>
			{text.map((run, index) => {
				const key = `${index}-${run.text}`;
				if (run.bold && run.italic) {
					return (
						<strong key={key}>
							<em>{run.text}</em>
						</strong>
					);
				}
				if (run.bold) return <strong key={key}>{run.text}</strong>;
				if (run.italic) return <em key={key}>{run.text}</em>;
				return <span key={key}>{run.text}</span>;
			})}
		</>
	);
}

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
				large ? "text-[5.4cqw]" : "text-[3.4cqw]",
				theme.heading,
			)}
		>
			<RichTextView text={heading.text} />
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
					className={cn("leading-snug text-pretty", large ? "text-[2.2cqw]" : "text-[1.8cqw]", theme.body)}
				>
					<RichTextView text={paragraph.text} />
				</p>
			))}
		</>
	);
}

function Bullets({ node, theme }: { node: BulletsNode; theme: CardTheme }) {
	return (
		<ul data-node-id={node.id} className="flex flex-col gap-[1.2cqw]">
			{node.items.map((item) => (
				<li
					key={item.id}
					data-node-id={item.id}
					className={cn("flex gap-[1.4cqw] text-[1.9cqw] leading-snug", theme.body)}
				>
					<span aria-hidden className={cn("mt-[0.9cqw] size-[0.7cqw] shrink-0 rounded-full bg-current", theme.accent)} />
					<span>
						<RichTextView text={item.text} />
					</span>
				</li>
			))}
		</ul>
	);
}

function Columns({ node, theme }: { node: ColumnsNode; theme: CardTheme }) {
	return (
		<div
			data-node-id={node.id}
			className="grid flex-1 gap-[3cqw]"
			style={{ gridTemplateColumns: `repeat(${node.columns.length}, minmax(0, 1fr))` }}
		>
			{node.columns.map((column, index) => (
				<div
					key={column.id}
					data-node-id={column.id}
					className={cn("flex flex-col gap-[1.4cqw]", index > 0 && "border-l pl-[3cqw]", theme.rule)}
				>
					<h3 className={cn("text-[2.1cqw] font-semibold", theme.accent)}>{column.heading}</h3>
					<ul className="flex flex-col gap-[1cqw]">
						{column.items.map((item) => (
							<li key={item.id} data-node-id={item.id} className={cn("text-[1.7cqw] leading-snug", theme.body)}>
								<RichTextView text={item.text} />
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}

function Steps({ node, theme }: { node: StepsNode; theme: CardTheme }) {
	return (
		<ol
			data-node-id={node.id}
			className="grid flex-1 gap-[2.4cqw]"
			style={{ gridTemplateColumns: `repeat(${node.items.length}, minmax(0, 1fr))` }}
		>
			{node.items.map((step, index) => (
				<li key={step.id} data-node-id={step.id} className={cn("flex flex-col gap-[1cqw] border-t pt-[1.6cqw]", theme.rule)}>
					<span className={cn("text-[1.6cqw] font-semibold tabular-nums", theme.accent)}>
						{String(index + 1).padStart(2, "0")}
					</span>
					<span className={cn("text-[1.9cqw] font-semibold leading-tight", theme.heading)}>{step.title}</span>
					{step.detail && (
						<span className={cn("text-[1.5cqw] leading-snug", theme.body)}>
							<RichTextView text={step.detail} />
						</span>
					)}
				</li>
			))}
		</ol>
	);
}

function Stats({ nodes, theme }: { nodes: StatNode[]; theme: CardTheme }) {
	return (
		<div className="grid gap-[3cqw]" style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}>
			{nodes.map((stat) => (
				<div key={stat.id} data-node-id={stat.id} className="flex flex-col gap-[0.6cqw]">
					<span className={cn("text-[5cqw] font-semibold leading-none tabular-nums", theme.accent)}>{stat.value}</span>
					<span className={cn("text-[1.6cqw] leading-snug", theme.body)}>{stat.label}</span>
				</div>
			))}
		</div>
	);
}

function Quote({ node, theme }: { node: QuoteNode; theme: CardTheme }) {
	return (
		<figure data-node-id={node.id} className="flex flex-col gap-[2cqw]">
			<blockquote className={cn("text-[3.2cqw] font-medium leading-[1.2] text-balance", theme.heading)}>
				<span className={theme.accent}>“</span>
				<RichTextView text={node.text} />
				<span className={theme.accent}>”</span>
			</blockquote>
			{node.attribution && <figcaption className={cn("text-[1.7cqw]", theme.muted)}>{node.attribution}</figcaption>}
		</figure>
	);
}

function CardBody({ card, theme }: { card: Card; theme: CardTheme }) {
	switch (card.layout) {
		case "title":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[2cqw]">
					<Heading card={card} theme={theme} large />
					<Paragraphs card={card} theme={theme} large />
				</div>
			);
		case "statement":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[2.4cqw]">
					<Heading card={card} theme={theme} />
					<Paragraphs card={card} theme={theme} large />
				</div>
			);
		case "bullets":
			return (
				<div className="flex flex-1 flex-col gap-[3cqw]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "bullets").map((node) => (
						<Bullets key={node.id} node={node} theme={theme} />
					))}
					<Paragraphs card={card} theme={theme} />
				</div>
			);
		case "comparison":
			return (
				<div className="flex flex-1 flex-col gap-[3cqw]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "columns").map((node) => (
						<Columns key={node.id} node={node} theme={theme} />
					))}
				</div>
			);
		case "process":
			return (
				<div className="flex flex-1 flex-col gap-[3.4cqw]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "steps").map((node) => (
						<Steps key={node.id} node={node} theme={theme} />
					))}
				</div>
			);
		case "quote":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[2.4cqw]">
					<Heading card={card} theme={theme} />
					{nodesOf(card, "quote").map((node) => (
						<Quote key={node.id} node={node} theme={theme} />
					))}
				</div>
			);
		case "stats":
			return (
				<div className="flex flex-1 flex-col justify-center gap-[3.4cqw]">
					<Heading card={card} theme={theme} />
					<Stats nodes={nodesOf(card, "stat")} theme={theme} />
					<Paragraphs card={card} theme={theme} />
				</div>
			);
	}
}

export interface CardViewProps {
	card: Card;
	theme: CardTheme;
	/** One-based position, shown in the card's corner. */
	position: number;
	/** Maps a card's source IDs to their citation numbers and links. */
	sources?: Record<string, { number: number; url: string; title?: string }>;
}

/**
 * One card with text sized to the card, not the window. A card is at least
 * 16:9 and grows when its content needs more room, so nothing is ever
 * cropped. `data-overflows-slide` marks a card taller than one slide, which
 * PPTX export must split or refuse rather than crop.
 */
export function CardView({ card, theme, position, sources }: CardViewProps) {
	const cited = card.sourceIds.flatMap((id) => (sources?.[id] ? [sources[id]] : []));
	const articleRef = useRef<HTMLElement>(null);
	const [overflows, setOverflows] = useState(false);

	useLayoutEffect(() => {
		const article = articleRef.current;
		if (!article || typeof ResizeObserver === "undefined") return undefined;
		const measure = () => setOverflows(article.offsetHeight > Math.ceil((article.offsetWidth * 9) / 16) + 1);
		const observer = new ResizeObserver(measure);
		observer.observe(article);
		measure();
		return () => observer.disconnect();
	}, []);

	return (
		<div className="@container w-full">
			<article
				ref={articleRef}
				data-card-id={card.id}
				data-overflows-slide={overflows || undefined}
				aria-label={`Card ${position}: ${card.takeaway}`}
				className={cn(
					"flex min-h-[56.25cqw] w-full flex-col rounded-[1.2cqw] px-[6cqw] pt-[5cqw] pb-[2.2cqw]",
					theme.surface,
				)}
			>
				<div className="flex flex-1 flex-col pb-[2.8cqw]">
					<CardBody card={card} theme={theme} />
				</div>
				<footer className={cn("flex items-end justify-between text-[1.1cqw]", theme.muted)}>
					<span className="flex gap-[0.8cqw]">
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
					</span>
					<span className="tabular-nums">{position}</span>
				</footer>
			</article>
		</div>
	);
}
