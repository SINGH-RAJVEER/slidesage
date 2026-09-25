import { type CardDocument, setTheme, setTitle, THEMES, type ThemeId } from "@slidesage/cards";
import type { Source } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { type CardAsset, CardDeck } from "@slidesage/ui/components/Cards";
import { Input } from "@slidesage/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@slidesage/ui/components/select";
import { API_URL } from "@slidesage/ui/lib/api";
import { Check, Pencil, Redo2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

/** A saved deck, readable by default and editable in place. */
export function DeckWorkspace({ presentationId, document, revision, sources, assets, onReload }: DeckWorkspaceProps) {
	const [editing, setEditing] = useState(false);
	const assetIds = useMemo(() => Object.keys(assets), [assets]);
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

	const finish = async () => {
		await editor.flush();
		setEditing(false);
	};

	return (
		<>
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
					<h1 className="min-w-0 flex-1 text-2xl font-semibold text-white">{editor.document.title}</h1>
				)}
				{editing && (
					<>
						<Select
							value={editor.document.theme}
							onValueChange={(theme) => editor.edit((current) => setTheme(current, theme as ThemeId))}
						>
							<SelectTrigger aria-label="Theme" className="h-9 w-32 border-white/10 bg-transparent text-white/80">
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
					onClick={() => (editing ? void finish() : setEditing(true))}
					disabled={blocked}
					className="gap-2 text-white/80 hover:bg-white/10 hover:text-white"
				>
					{editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
					{editing ? "Done" : "Edit"}
				</Button>
			</div>
			{editing && (
				<div role="status" aria-live="polite" className="-mt-5 flex items-center gap-3 text-xs text-white/50">
					<span
						className={
							status.state === "invalid" || status.state === "error" || blocked ? "text-amber-200" : undefined
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
			<CardDeck
				document={editor.document}
				sources={sources}
				assets={assets}
				assetUrl={(assetId) => `${API_URL}/presentations/${encodeURIComponent(presentationId)}/assets/${assetId}`}
				edit={editing && !blocked ? editor.edit : undefined}
			/>
		</>
	);
}
