import {
	type CardDocument,
	setImage,
	setTheme,
	setTitle,
	THEMES,
	type ThemeId,
} from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { useStreaming } from "@slidesage/ui";
import { Button } from "@slidesage/ui/components/button";
import {
	type CardAsset,
	CardDeck,
	PhotoPicker,
	PresentMode,
	type StockPhoto,
} from "@slidesage/ui/components/Cards";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { Input } from "@slidesage/ui/components/input";
import { Progress } from "@slidesage/ui/components/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@slidesage/ui/components/select";
import { API_URL } from "@slidesage/ui/lib/api";
import { Check, Link2, Pencil, Play, Redo2, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ReviseDialog } from "./ReviseDialog";
import { ShareDialog } from "./ShareDialog";
import { type SaveStatus, useDocumentEditor } from "./useDocumentEditor";

const THEME_NAMES: Record<ThemeId, string> = { slate: "Slate", paper: "Paper", ember: "Ember" };

function statusText(status: SaveStatus): string {
	switch (status.state) {
		case "saved":
			return "All changes saved";
		case "pending":
			return "Unsaved changes";
		case "saving":
			return "Saving";
		default:
			return status.message;
	}
}

export interface DeckWorkspaceProps {
	presentationId: string;
	document: CardDocument;
	revision: number;
	sources: Source[];
	assets: Record<string, CardAsset>;
	/** Loads the latest saved revision, discarding the local copy. */
	onReload: () => void;
}

async function readError(response: Response, fallback: string): Promise<string> {
	const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
	return body?.error?.message ?? fallback;
}

/** A saved deck, readable by default, editable in place, and presentable. */
export function DeckWorkspace({
	presentationId,
	document,
	revision,
	sources,
	assets: initialAssets,
	onReload,
}: DeckWorkspaceProps) {
	const [editing, setEditing] = useState(false);
	const [presenting, setPresenting] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [assets, setAssets] = useState(initialAssets);
	const [photoCard, setPhotoCard] = useState<string | null>(null);
	// The cards an AI revision will rewrite; empty means the whole deck.
	const [reviseCards, setReviseCards] = useState<string[] | null>(null);
	const [reviseError, setReviseError] = useState<string | null>(null);
	const { streamingState, generate } = useStreaming();
	const revising =
		streamingState.isStreaming &&
		streamingState.operation === "iteration" &&
		streamingState.presentationId === presentationId;
	const assetIds = useMemo(() => Object.keys(assets), [assets]);
	const presentationUrl = `${API_URL}/presentations/${encodeURIComponent(presentationId)}`;
	const assetUrl = (assetId: string) => `${presentationUrl}/assets/${assetId}`;
	const editor = useDocumentEditor({ presentationId, initial: document, revision, assetIds });
	const { status } = editor;
	const blocked = status.state === "conflict";

	useEffect(() => {
		if (!editing) return undefined;
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.isContentEditable || target?.tagName === "INPUT") return;
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) editor.redo();
				else editor.undo();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [editing, editor.redo, editor.undo]);

	const placePhoto = async (response: Response, fallbackAlt: string) => {
		if (!response.ok) throw new Error(await readError(response, "The photo could not be added."));
		const body = (await response.json()) as { assetId: string; asset: CardAsset; alt: string };
		const cardId = photoCard;
		setAssets((current) => ({ ...current, [body.assetId]: body.asset }));
		if (cardId) {
			editor.edit((current) => setImage(current, cardId, body.assetId, body.alt || fallbackAlt));
		}
		setPhotoCard(null);
	};

	const searchPhotos = async (query: string): Promise<StockPhoto[]> => {
		const response = await fetch(`${API_URL}/images/search?q=${encodeURIComponent(query)}`, {
			credentials: "include",
		});
		if (!response.ok) throw new Error(await readError(response, "Photo search failed."));
		return ((await response.json()) as { photos: StockPhoto[] }).photos;
	};

	const choosePhoto = async (photo: StockPhoto, query: string) => {
		const response = await fetch(`${presentationUrl}/assets/stock`, {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ photoId: photo.id, query }),
		});
		await placePhoto(response, query || "Photo");
	};

	const uploadPhoto = async (file: File) => {
		const form = new FormData();
		form.append("file", file);
		const response = await fetch(`${presentationUrl}/assets/upload`, {
			method: "POST",
			credentials: "include",
			body: form,
		});
		const name = file.name
			.replace(/\.[a-z0-9]+$/i, "")
			.replace(/[-_]+/g, " ")
			.trim();
		await placePhoto(response, name.slice(0, 200) || "Uploaded image");
	};

	const photoCardHeading = (() => {
		const card = photoCard ? editor.document.cards[photoCard] : undefined;
		const heading = card?.nodes.find((node) => node.type === "heading");
		return heading?.type === "heading" ? heading.text.map((run) => run.text).join("") : "";
	})();

	// An AI revision starts from the saved revision, so pending edits are saved
	// first and editing stays off until the revision is saved.
	const revise = async (cardIds: string[], instruction: string) => {
		setReviseError(null);
		await editor.flush();
		if (!editor.isSaved()) {
			setReviseError("Save or reload your changes before revising with AI.");
			return;
		}
		setEditing(false);
		const done = await generate({
			prompt: instruction,
			slideCount: editor.document.cardOrder.length,
			detailLevel: "balanced",
			tonality: "professional",
			parentPresentationId: presentationId,
			baseRevision: editor.savedRevision(),
			cardIds,
		});
		if (!done) setReviseError((current) => current ?? "The revision did not finish.");
	};

	useEffect(() => {
		if (streamingState.operation === "iteration" && streamingState.error) {
			setReviseError(streamingState.error);
		}
	}, [streamingState.operation, streamingState.error]);

	const reviseScope = (() => {
		if (!reviseCards || reviseCards.length === 0) return "every card";
		const index = editor.document.cardOrder.indexOf(reviseCards[0] ?? "");
		return `card ${index + 1}`;
	})();

	const progress = streamingState.generationProgress;

	const finish = async () => {
		await editor.flush();
		setEditing(false);
	};

	return (
		<>
			<FloatingNotice error={reviseError} onDismiss={() => setReviseError(null)} />
			<div className="flex flex-wrap items-center gap-3">
				{editing ? (
					<Input
						aria-label="Presentation title"
						value={editor.document.title}
						maxLength={120}
						onChange={(event) => editor.edit((current) => setTitle(current, event.target.value))}
						className="h-10 min-w-0 flex-1 border-white/10 bg-transparent text-xl font-semibold text-white"
					/>
				) : (
					<h1 className="min-w-0 flex-1 text-2xl font-semibold text-white">
						{editor.document.title}
					</h1>
				)}
				{editing && (
					<>
						<Select
							value={editor.document.theme}
							onValueChange={(theme) =>
								editor.edit((current) => setTheme(current, theme as ThemeId))
							}
						>
							<SelectTrigger
								aria-label="Theme"
								className="h-9 w-32 border-white/10 bg-transparent text-white/80"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{THEMES.map((theme) => (
									<SelectItem key={theme} value={theme}>
										{THEME_NAMES[theme]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Undo"
							disabled={!editor.canUndo || blocked}
							onClick={editor.undo}
							className="text-white/70 hover:bg-white/10 hover:text-white"
						>
							<Undo2 className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Redo"
							disabled={!editor.canRedo || blocked}
							onClick={editor.redo}
							className="text-white/70 hover:bg-white/10 hover:text-white"
						>
							<Redo2 className="size-4" />
						</Button>
					</>
				)}
				<Button
					variant="ghost"
					onClick={() => setReviseCards([])}
					disabled={revising || blocked}
					className="gap-2 text-white/80 hover:bg-white/10 hover:text-white"
				>
					<Sparkles className="size-4" />
					Revise with AI
				</Button>
				{!editing && (
					<Button
						variant="ghost"
						onClick={() => setSharing(true)}
						className="gap-2 text-white/80 hover:bg-white/10 hover:text-white"
					>
						<Link2 className="size-4" />
						Share
					</Button>
				)}
				{!editing && (
					<Button
						variant="ghost"
						onClick={() => setPresenting(true)}
						className="gap-2 text-white/80 hover:bg-white/10 hover:text-white"
					>
						<Play className="size-4" />
						Present
					</Button>
				)}
				<Button
					variant="ghost"
					onClick={() => (editing ? void finish() : setEditing(true))}
					disabled={blocked || revising}
					className="gap-2 text-white/80 hover:bg-white/10 hover:text-white"
				>
					{editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
					{editing ? "Done" : "Edit"}
				</Button>
			</div>
			{editing && (
				<div
					role="status"
					aria-live="polite"
					className="-mt-5 flex items-center gap-3 text-xs text-white/50"
				>
					<span
						className={
							status.state === "invalid" || status.state === "error" || blocked
								? "text-amber-200"
								: undefined
						}
					>
						{statusText(status)}
					</span>
					{blocked && (
						<Button variant="link" className="h-auto p-0 text-xs text-sky-300" onClick={onReload}>
							Reload the latest version
						</Button>
					)}
				</div>
			)}
			{revising && (
				<div role="status" aria-live="polite" className="-mt-4 flex flex-col gap-2">
					<p className="text-sm text-white/60">
						{streamingState.generationMessage ?? "Revising cards"}. The deck is read-only until the
						revision is saved.
					</p>
					<Progress
						value={progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0}
						aria-label="Revision progress"
					/>
				</div>
			)}
			<CardDeck
				document={editor.document}
				sources={sources}
				assets={assets}
				assetUrl={assetUrl}
				edit={editing && !blocked && !revising ? editor.edit : undefined}
				onPhoto={editing && !blocked && !revising ? setPhotoCard : undefined}
				onRevise={
					editing && !blocked && !revising ? (cardId) => setReviseCards([cardId]) : undefined
				}
			/>
			<ReviseDialog
				open={reviseCards !== null}
				onOpenChange={(open) => {
					if (!open) setReviseCards(null);
				}}
				scope={reviseScope}
				onSubmit={(instruction) => void revise(reviseCards ?? [], instruction)}
			/>
			<PhotoPicker
				open={photoCard !== null}
				onOpenChange={(open) => {
					if (!open) setPhotoCard(null);
				}}
				initialQuery={photoCardHeading}
				search={searchPhotos}
				choose={choosePhoto}
				upload={uploadPhoto}
			/>
			<ShareDialog presentationId={presentationId} open={sharing} onOpenChange={setSharing} />
			{presenting && (
				<PresentMode
					document={editor.document}
					sources={sources}
					assets={assets}
					assetUrl={assetUrl}
					onExit={() => setPresenting(false)}
				/>
			)}
		</>
	);
}
