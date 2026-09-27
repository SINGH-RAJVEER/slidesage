import { CARD_SCHEMA_VERSION, type CardDocument, validateCardDocument } from "@slidesage/cards";
import type { DraftPreview } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { type CardAsset, CardDeck } from "@slidesage/ui/components/Cards";
import { Progress } from "@slidesage/ui/components/progress";
import { Skeleton } from "@slidesage/ui/components/skeleton";
import { useMemo } from "react";

export interface DraftPreviewViewProps {
	preview: DraftPreview;
	assetUrl: (assetId: string) => string;
	message: string;
	percent: number;
	onCancel: () => void;
}

/**
 * The deck as it is drafted. Finished cards render as they will look; cards
 * still being written show their planned point. None of it is saved until
 * the whole document commits.
 */
export function DraftPreviewView({
	preview,
	assetUrl,
	message,
	percent,
	onCancel,
}: DraftPreviewViewProps) {
	const drafted = useMemo(() => {
		const cards = preview.entries.flatMap((entry) => {
			const card = preview.cards[String(entry.position)];
			return card ? [card as { id: string }] : [];
		});
		if (cards.length === 0) return null;
		const candidate = {
			schemaVersion: CARD_SCHEMA_VERSION,
			title: preview.title || "Untitled presentation",
			theme: "slate",
			cardOrder: cards.map((card) => card.id),
			cards: Object.fromEntries(cards.map((card) => [card.id, card])),
		};
		const result = validateCardDocument(candidate, {
			knownAssets: new Set(Object.keys(preview.assets)),
		});
		return result.ok ? (result.value as CardDocument) : null;
	}, [preview]);
	const pending = preview.entries.filter((entry) => !preview.cards[String(entry.position)]);

	return (
		<>
			<div className="flex flex-wrap items-center gap-4">
				<h1 className="min-w-0 flex-1 text-2xl font-semibold text-white">{preview.title}</h1>
				<Button
					variant="ghost"
					onClick={onCancel}
					className="text-white/70 hover:bg-white/10 hover:text-white"
				>
					Cancel generation
				</Button>
			</div>
			<div className="-mt-4 flex flex-col gap-2" aria-live="polite">
				<p className="text-sm text-white/60">
					{message} · {preview.completed} of {preview.total} cards written
				</p>
				<Progress value={percent} aria-label="Generation progress" />
			</div>
			{drafted && (
				<CardDeck
					document={drafted}
					assets={preview.assets as Record<string, CardAsset>}
					assetUrl={assetUrl}
				/>
			)}
			{pending.length > 0 && (
				<ol aria-label="Cards being written" className="flex flex-col gap-8">
					{pending.map((entry) => (
						<li key={entry.position} className="@container w-full">
							<div className="relative flex min-h-[56.25cqw] w-full flex-col justify-center gap-[2cqw] rounded-[1.2cqw] bg-white/[0.03] px-[6cqw]">
								<Skeleton className="h-[3cqw] w-2/3 bg-white/10" />
								<p className="text-[1.8cqw] text-white/40">{entry.takeaway}</p>
								<Skeleton className="h-[1.6cqw] w-1/2 bg-white/5" />
								<span className="absolute right-[6cqw] bottom-[2.2cqw] text-[1.1cqw] text-white/30 tabular-nums">
									{entry.position}
								</span>
							</div>
						</li>
					))}
				</ol>
			)}
		</>
	);
}
