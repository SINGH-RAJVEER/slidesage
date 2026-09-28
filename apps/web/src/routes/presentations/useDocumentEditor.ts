import { type CardDocument, validateCardDocument } from "@slidesage/cards";
import { API_URL } from "@slidesage/ui/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus =
	| { state: "saved" }
	| { state: "pending" }
	| { state: "saving" }
	| { state: "invalid"; message: string }
	| { state: "conflict"; message: string }
	| { state: "error"; message: string };

interface History {
	past: CardDocument[];
	present: CardDocument;
	future: CardDocument[];
}

/** Edits closer together than this undo as one step, so typing is not undone a letter at a time. */
const COALESCE_MS = 800;
/** Quiet time after the last edit before it is saved. */
const SAVE_DELAY_MS = 1200;
const HISTORY_LIMIT = 100;

export interface DocumentEditor {
	document: CardDocument;
	edit: (update: (document: CardDocument) => CardDocument) => void;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
	status: SaveStatus;
	/** Saves now instead of waiting for the edits to settle. */
	flush: () => Promise<void>;
	/** The revision the latest save produced, read at call time. */
	savedRevision: () => number;
	/** True when every edit is saved and saving is not blocked by a conflict. */
	isSaved: () => boolean;
}

/**
 * Local editing state for a saved card document. Every settled change is
 * validated with the shared schema and saved as a new revision on top of the
 * revision it was based on. A save that finds a newer revision stops
 * autosaving, so the editor never overwrites someone else's change.
 */
export function useDocumentEditor(options: {
	presentationId: string;
	initial: CardDocument;
	revision: number;
	assetIds: string[];
	onSaved?: (document: CardDocument, revision: number) => void;
}): DocumentEditor {
	const { presentationId, assetIds, onSaved } = options;
	const [history, setHistory] = useState<History>({
		past: [],
		present: options.initial,
		future: [],
	});
	const [status, setStatus] = useState<SaveStatus>({ state: "saved" });
	const base = useRef(options.revision);
	const saved = useRef<CardDocument>(options.initial);
	const lastEdit = useRef(0);
	const saving = useRef<Promise<void> | null>(null);
	const blocked = useRef(false);
	const pendingOperation = useRef<{ document: CardDocument; id: string } | null>(null);
	const present = useRef(history.present);
	present.current = history.present;

	const edit = useCallback((update: (document: CardDocument) => CardDocument) => {
		setHistory((current) => {
			const next = update(current.present);
			if (next === current.present) return current;
			const now = Date.now();
			const coalesce = now - lastEdit.current < COALESCE_MS && current.past.length > 0;
			lastEdit.current = now;
			return {
				past: coalesce ? current.past : [...current.past, current.present].slice(-HISTORY_LIMIT),
				present: next,
				future: [],
			};
		});
	}, []);

	const undo = useCallback(() => {
		lastEdit.current = 0;
		setHistory((current) => {
			const previous = current.past[current.past.length - 1];
			if (!previous) return current;
			return {
				past: current.past.slice(0, -1),
				present: previous,
				future: [current.present, ...current.future],
			};
		});
	}, []);

	const redo = useCallback(() => {
		lastEdit.current = 0;
		setHistory((current) => {
			const [next, ...future] = current.future;
			if (!next) return current;
			return { past: [...current.past, current.present], present: next, future };
		});
	}, []);

	const save = useCallback(async () => {
		if (blocked.current) return;
		const document = present.current;
		if (document === saved.current) {
			setStatus({ state: "saved" });
			return;
		}
		const checked = validateCardDocument(document, { knownAssets: new Set(assetIds) });
		if (!checked.ok) {
			setStatus({
				state: "invalid",
				message: describeIssue(checked.issue.path, checked.issue.message),
			});
			return;
		}
		// A retry of the same document reuses its operation ID, so a save whose
		// response was lost is not applied twice.
		if (pendingOperation.current?.document !== document) {
			pendingOperation.current = { document, id: crypto.randomUUID() };
		}
		setStatus({ state: "saving" });
		try {
			const response = await fetch(
				`${API_URL}/presentations/${encodeURIComponent(presentationId)}/document`,
				{
					method: "PUT",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						baseRevision: base.current,
						operationId: pendingOperation.current.id,
						document: checked.value,
					}),
				},
			);
			const body = (await response.json().catch(() => null)) as {
				revision?: { revision: number };
				error?: { message?: string };
			} | null;
			if (response.status === 409) {
				blocked.current = true;
				setStatus({
					state: "conflict",
					message: body?.error?.message ?? "This presentation was changed elsewhere.",
				});
				return;
			}
			if (!response.ok || !body?.revision) {
				setStatus({ state: "error", message: body?.error?.message ?? "Unable to save changes." });
				return;
			}
			base.current = body.revision.revision;
			saved.current = document;
			pendingOperation.current = null;
			onSaved?.(document, body.revision.revision);
			setStatus(present.current === document ? { state: "saved" } : { state: "pending" });
		} catch {
			setStatus({ state: "error", message: "Unable to save changes. Check your connection." });
		}
	}, [assetIds, onSaved, presentationId]);

	const flush = useCallback(async () => {
		while (saving.current) await saving.current;
		saving.current = save().finally(() => {
			saving.current = null;
		});
		await saving.current;
	}, [save]);

	useEffect(() => {
		if (history.present === saved.current || blocked.current) return undefined;
		setStatus((current) => (current.state === "saving" ? current : { state: "pending" }));
		const timer = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [flush, history.present]);

	// Unsaved edits would be lost with the tab, so leaving asks first.
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (present.current !== saved.current) event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, []);

	return {
		document: history.present,
		edit,
		undo,
		redo,
		canUndo: history.past.length > 0,
		canRedo: history.future.length > 0,
		status,
		flush,
		savedRevision: () => base.current,
		isSaved: () => present.current === saved.current && !blocked.current,
	};
}

function describeIssue(path: string, message: string): string {
	if (message === "must not be empty" || message === "must not be blank") {
		return "A text field is empty. Fill it in or remove it to save.";
	}
	const limit = /is (\d+) characters, the limit is (\d+)/.exec(message);
	if (limit) return `Some text is ${limit[1]} characters; the limit there is ${limit[2]}.`;
	return `This change cannot be saved: ${path} ${message}.`;
}
