import {
	type CardDocument,
	deleteCard,
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
	CardToolbar,
	PhotoPicker,
	type PhotoSearch,
	type StockPhoto,
} from "@slidesage/ui/components/Cards";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@slidesage/ui/components/dialog";
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
import { deckFromDocument, IterateModal, type IterateScope } from "@slidesage/ui/components/Viewer";
import { API_URL } from "@slidesage/ui/lib/api";
import { Check, Link2, Pencil, Redo2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../app/router/paths";
import { DeckViewer } from "./DeckViewer";
import { ShareDialog } from "./ShareDialog";
import { type SaveStatus, useDocumentEditor } from "./useDocumentEditor";

const THEME_NAMES: Record<ThemeId, string> = { slate: "Slate", paper: "Paper", ember: "Ember" };

const headerButtonClassName =
	"bg-white/5 hover:bg-white/10 backdrop-blur-lg border border-white/5 text-white transition-all duration-300";

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

/** The file name the server gave a download, if it gave one. */
function downloadName(response: Response, fallback: string): string {
	const header = response.headers.get("Content-Disposition") ?? "";
	const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
	if (encoded) {
		try {
			return decodeURIComponent(encoded);
		} catch {
			// Fall through to the plain name.
		}
	}
	return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

async function readError(response: Response, fallback: string): Promise<string> {
	const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
	return body?.error?.message ?? fallback;
}

/**
 * Where the carousel should go after the card order changes: to a card that
 * was just added, else to the card that was on screen, else to the slide that
 * took the place of a deleted one.
 */
function followCard(previous: string[], next: string[], currentId?: string): number | undefined {
	const added = next.find((id) => !previous.includes(id));
	if (added) return next.indexOf(added);
	if (currentId && next.includes(currentId)) {
		return next.indexOf(currentId) === previous.indexOf(currentId)
			? undefined
			: next.indexOf(currentId);
	}
	const removedAt = currentId ? previous.indexOf(currentId) : -1;
	return removedAt >= 0 ? Math.min(removedAt, next.length - 1) : undefined;
}

/** A saved deck in the viewer: readable by default, editable in place, and presentable. */
export function DeckWorkspace({
	presentationId,
	document,
	revision,
	sources,
	assets: initialAssets,
	onReload,
}: DeckWorkspaceProps) {
	const navigate = useNavigate();
	const [editing, setEditing] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [assets, setAssets] = useState(initialAssets);
	const [photoCard, setPhotoCard] = useState<string | null>(null);
	// The scope the iterate panel opened with; null while it is closed.
	const [iterateScope, setIterateScope] = useState<IterateScope | null>(null);
	const [currentSlide, setCurrentSlide] = useState(0);
	const [slideToDelete, setSlideToDelete] = useState<number>();
	const [notice, setNotice] = useState<string | null>(null);
	const { streamingState, generate } = useStreaming();
	const revising =
		streamingState.isStreaming &&
		streamingState.operation === "iteration" &&
		streamingState.presentationId === presentationId;
	const assetIds = useMemo(() => Object.keys(assets), [assets]);
	const presentationUrl = `${API_URL}/presentations/${encodeURIComponent(presentationId)}`;
	const editor = useDocumentEditor({ presentationId, initial: document, revision, assetIds });
	const { status } = editor;
	const blocked = status.state === "conflict";
	const canEdit = !blocked && !revising;
	const deck = useMemo(
		() =>
			deckFromDocument(editor.document, {
				sources,
				assets,
				assetUrl: (assetId) => `${presentationUrl}/assets/${assetId}`,
			}),
		[editor.document, sources, assets, presentationUrl],
	);

	// Keep the card on screen in view when the order changes under it.
	const [focusRequest, setFocusRequest] = useState<{ index: number }>();
	const currentSlideRef = useRef(0);
	const previousOrder = useRef(editor.document.cardOrder);
	useEffect(() => {
		const previous = previousOrder.current;
		const next = editor.document.cardOrder;
		previousOrder.current = next;
		if (previous === next) return;
		const index = followCard(previous, next, previous[currentSlideRef.current]);
		if (index !== undefined) setFocusRequest({ index });
	}, [editor.document.cardOrder]);

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

	const searchPhotos = async (query: string, provider?: string): Promise<PhotoSearch> => {
		const params = new URLSearchParams({ q: query });
		if (provider) params.set("provider", provider);
		const response = await fetch(`${API_URL}/images/search?${params}`, { credentials: "include" });
		if (!response.ok) throw new Error(await readError(response, "Photo search failed."));
		return (await response.json()) as PhotoSearch;
	};

	const choosePhoto = async (photo: StockPhoto, query: string) => {
		const response = await fetch(`${presentationUrl}/assets/stock`, {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider: photo.provider, photoId: photo.id, query }),
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
		setNotice(null);
		await editor.flush();
		if (!editor.isSaved()) {
			setNotice("Save or reload your changes before revising with AI.");
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
		if (!done) setNotice((current) => current ?? "The revision did not finish.");
	};

	useEffect(() => {
		if (streamingState.operation === "iteration" && streamingState.error) {
			setNotice(streamingState.error);
		}
	}, [streamingState.operation, streamingState.error]);

	// The deck without the slide autosaves as the next revision; while
	// editing, Undo brings the slide back.
	const confirmDelete = () => {
		const cardId =
			slideToDelete === undefined ? undefined : editor.document.cardOrder[slideToDelete];
		setSlideToDelete(undefined);
		if (cardId) editor.edit((current) => deleteCard(current, cardId));
	};

	// The export is built from the saved revision, so it is offered only when
	// there are no unsaved edits.
	const downloadPptx = async () => {
		const response = await fetch(`${presentationUrl}/export/pptx`, { credentials: "include" });
		if (!response.ok) {
			throw new Error(await readError(response, "The presentation could not be exported."));
		}
		const url = URL.createObjectURL(await response.blob());
		const link = window.document.createElement("a");
		link.href = url;
		link.download = downloadName(response, `${editor.document.title || "Presentation"}.pptx`);
		link.click();
		// The click starts the download; the URL can go once it has.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	const finish = async () => {
		await editor.flush();
		setEditing(false);
	};

	const progress = streamingState.generationProgress;
	const editAllowed = editing && canEdit;

	return (
		<DeckViewer
			title={editor.document.title}
			deck={deck}
			onBack={() => navigate(ROUTES.presentations)}
			edit={editAllowed ? editor.edit : undefined}
			iterate={{
				canIterate: canEdit,
				onIterate: () => setIterateScope((open) => (open ? null : "deck")),
			}}
			presentDisabled={editing}
			focusRequest={focusRequest}
			onSlideChange={(index) => {
				currentSlideRef.current = index;
				setCurrentSlide(index);
			}}
			titleEditor={
				editing ? (
					<Input
						aria-label="Presentation title"
						value={editor.document.title}
						maxLength={120}
						onChange={(event) => editor.edit((current) => setTitle(current, event.target.value))}
						className="h-10 min-w-0 flex-1 border-white/10 bg-transparent text-lg font-light text-white"
					/>
				) : undefined
			}
			headerTools={
				editing ? (
					<>
						<Select
							value={editor.document.theme}
							onValueChange={(theme) =>
								editor.edit((current) => setTheme(current, theme as ThemeId))
							}
						>
							<SelectTrigger
								aria-label="Theme"
								className="h-9 w-32 border-white/5 bg-white/5 text-white"
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
				) : undefined
			}
			headerActions={
				<>
					{!editing && (
						<Button
							variant="outline"
							onClick={() => setSharing(true)}
							className={headerButtonClassName}
						>
							<Link2 className="mr-2 size-4" />
							Share
						</Button>
					)}
					<Button
						variant="outline"
						onClick={() => (editing ? void finish() : setEditing(true))}
						disabled={!canEdit}
						className={headerButtonClassName}
					>
						{editing ? <Check className="mr-2 size-4" /> : <Pencil className="mr-2 size-4" />}
						{editing ? "Done" : "Edit"}
					</Button>
				</>
			}
			slideControls={(currentSlide) => {
				const cardId = editor.document.cardOrder[currentSlide];
				if (revising) {
					return (
						<div role="status" aria-live="polite" className="flex flex-col gap-2 px-4 pt-3">
							<p className="text-sm text-white/60">
								{streamingState.generationMessage ?? "Revising cards"}. The deck is read-only until
								the revision is saved.
							</p>
							<Progress
								value={
									progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0
								}
								aria-label="Revision progress"
							/>
						</div>
					);
				}
				if (!editing) return null;
				return (
					<div className="flex min-h-10 flex-wrap items-center gap-3 px-4 pt-3">
						<div
							role="status"
							aria-live="polite"
							className="flex items-center gap-3 text-xs text-white/50"
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
								<Button
									variant="link"
									className="h-auto p-0 text-xs text-sky-300"
									onClick={onReload}
								>
									Reload the latest version
								</Button>
							)}
						</div>
						{editAllowed && cardId && (
							<div className="ml-auto">
								<CardToolbar
									document={editor.document}
									cardId={cardId}
									edit={editor.edit}
									onPhoto={setPhotoCard}
									onRevise={() => setIterateScope("slide")}
								/>
							</div>
						)}
					</div>
				);
			}}
			onExport={downloadPptx}
			downloadDisabled={editing || revising || status.state !== "saved"}
			onDeleteSlide={canEdit ? setSlideToDelete : undefined}
			deleteDisabled={editor.document.cardOrder.length <= 1}
			aside={
				<IterateModal
					open={iterateScope !== null}
					onOpenChange={(open) => {
						if (!open) setIterateScope(null);
					}}
					initialScope={iterateScope ?? "deck"}
					currentSlide={currentSlide + 1}
					isStreaming={!canEdit}
					onIterate={(instruction, scope) => {
						const cardId = editor.document.cardOrder[currentSlide];
						setIterateScope(null);
						void revise(scope === "slide" && cardId ? [cardId] : [], instruction);
						return true;
					}}
				/>
			}
		>
			<FloatingNotice error={notice} onDismiss={() => setNotice(null)} />
			<Dialog
				open={slideToDelete !== undefined}
				onOpenChange={(open) => {
					if (!open) setSlideToDelete(undefined);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Delete this slide?</DialogTitle>
						<DialogDescription>
							Slide {(slideToDelete ?? 0) + 1} is removed from the deck and a new revision is saved.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSlideToDelete(undefined)}>
							Keep slide
						</Button>
						<Button variant="destructive" onClick={confirmDelete}>
							Delete slide
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
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
		</DeckViewer>
	);
}
