import { type CardDocument, validateCardDocument } from "@slidesage/cards";
import { useAuth } from "@slidesage/ui";
import { API_URL } from "@slidesage/ui/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { pageDraftKey, readPageDraft, writePageDraft } from "../../hooks/usePageDraft";
import { type DraftOperation, isDocumentDraft, sameDocument } from "./document-draft";

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

/** One save request. A retry sends the same ID, so the server applies it once. */
type Operation = DraftOperation;

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
	/** Explicitly discards the local recovery draft before reloading the server version. */
	discardDraft: () => void;
	/** Whether the current edits were successfully stored in this browser. */
	hasLocalDraft: () => boolean;
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
	const { user } = useAuth();
	const draftKey = pageDraftKey(user?.id, `document:${presentationId}`);
	const ownerKey = `${draftKey}:owner`;
	const [recovery] = useState(() => {
		const draft = readPageDraft(draftKey, isDocumentDraft);
		if (!draft) return null;
		// A lost response may have reached the server. Reconcile that save first
		// instead of replaying it against a revision it already produced.
		if (draft.pendingOperation && sameDocument(draft.pendingOperation.document, options.initial)) {
			return {
				...draft,
				savedDocument: options.initial,
				baseRevision: options.revision,
				pendingOperation: null,
				conflict: false,
			};
		}
		return { ...draft, conflict: draft.baseRevision !== options.revision };
	});
	const [owner] = useState(() => crypto.randomUUID());
	const discarded = useRef(false);
	const recoveredDocument =
		recovery && !sameDocument(recovery.document, options.initial)
			? recovery.document
			: options.initial;
	const [history, setHistory] = useState<History>({
		past: recovery && recoveredDocument !== options.initial ? [options.initial] : [],
		present: recoveredDocument,
		future: [],
	});
	const [status, setStatus] = useState<SaveStatus>(
		recovery?.conflict
			? {
					state: "conflict",
					message: "This presentation was changed elsewhere. Reload it before editing.",
				}
			: { state: recoveredDocument === options.initial ? "saved" : "pending" },
	);
	const base = useRef(recovery?.baseRevision ?? options.revision);
	const saved = useRef<CardDocument>(options.initial);
	const lastEdit = useRef(0);
	const saving = useRef<Promise<void> | null>(null);
	const blocked = useRef(recovery?.conflict ?? false);
	// The last save that did not succeed, kept while it may still have landed.
	const pendingOperation = useRef<Operation | null>(
		recovery?.pendingOperation
			? {
					...recovery.pendingOperation,
					document: sameDocument(recovery.pendingOperation.document, recoveredDocument)
						? recoveredDocument
						: recovery.pendingOperation.document,
				}
			: null,
	);
	const present = useRef(history.present);
	present.current = history.present;
	// A save that may have landed without an answer is unsaved until it is
	// confirmed, even when the edits it carried were undone.
	const unsaved = () => present.current !== saved.current || pendingOperation.current !== null;
	const persist = useCallback(() => {
		if (discarded.current) return;
		// An older editor's in-flight save must not erase a newer editor's draft.
		if (readPageDraft(ownerKey, (value): value is string => typeof value === "string") !== owner)
			return;
		writePageDraft(
			draftKey,
			present.current !== saved.current || pendingOperation.current
				? {
						owner,
						document: present.current,
						savedDocument: saved.current,
						baseRevision: base.current,
						pendingOperation: pendingOperation.current,
					}
				: undefined,
		);
	}, [draftKey, owner, ownerKey]);
	useEffect(() => {
		// Take ownership once, before autosaving or processing new edits.
		writePageDraft(ownerKey, owner);
		if (recovery) writePageDraft(draftKey, { ...recovery, owner });
	}, [draftKey, owner, ownerKey, recovery]);
	useEffect(() => {
		persist();
	}, [history.present, persist]);

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

	/** Sends one save, reporting whether it is now the saved revision. */
	const send = useCallback(
		async (operation: Operation): Promise<boolean> => {
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
							operationId: operation.id,
							document: operation.validated,
						}),
					},
				);
				const body = (await response.json().catch(() => null)) as {
					revision?: { revision: number };
					error?: { message?: string };
				} | null;
				if (response.status === 409) {
					blocked.current = true;
					pendingOperation.current = null;
					persist();
					setStatus({
						state: "conflict",
						message: body?.error?.message ?? "This presentation was changed elsewhere.",
					});
					return false;
				}
				if (!response.ok || !body?.revision) {
					// A refusal means nothing was stored. A server error may have
					// come after the revision was, so that save stays pending.
					if (response.status < 500) pendingOperation.current = null;
					persist();
					setStatus({ state: "error", message: body?.error?.message ?? "Unable to save changes." });
					return false;
				}
				base.current = body.revision.revision;
				saved.current = operation.document;
				pendingOperation.current = null;
				persist();
				onSaved?.(operation.document, body.revision.revision);
				return true;
			} catch {
				setStatus({ state: "error", message: "Unable to save changes. Check your connection." });
				return false;
			}
		},
		[onSaved, persist, presentationId],
	);

	const save = useCallback(async () => {
		if (blocked.current) return;
		const document = present.current;
		// A save whose response was lost may still have landed, and a newer
		// save based on the revision before it would then conflict. Repeating
		// it first returns the revision it made, or makes it now.
		const unsettled = pendingOperation.current;
		if (unsettled && unsettled.document !== document && !(await send(unsettled))) return;
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
			pendingOperation.current = { document, validated: checked.value, id: crypto.randomUUID() };
		}
		persist();
		if (!(await send(pendingOperation.current))) return;
		setStatus(present.current === document ? { state: "saved" } : { state: "pending" });
	}, [assetIds, persist, send]);

	const flush = useCallback(async () => {
		while (saving.current) await saving.current;
		saving.current = save().finally(() => {
			saving.current = null;
		});
		await saving.current;
	}, [save]);

	useEffect(() => {
		if (blocked.current) return undefined;
		// Undoing back to the saved document leaves nothing to save, and clears
		// whatever the abandoned edits reported.
		if (history.present === saved.current && !pendingOperation.current) {
			setStatus((current) => (current.state === "saving" ? current : { state: "saved" }));
			return undefined;
		}
		setStatus((current) => (current.state === "saving" ? current : { state: "pending" }));
		const timer = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [flush, history.present]);

	// Leaving the deck in the app, or switching to another one, saves what the
	// timer had not yet; the latest flush is called so it knows every photo.
	const latestFlush = useRef(flush);
	latestFlush.current = flush;
	useEffect(
		() => () => {
			if (unsaved()) void latestFlush.current();
		},
		[],
	);

	// Unsaved edits would be lost with the tab, so leaving asks first.
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (unsaved()) event.preventDefault();
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
		isSaved: () => !unsaved() && !blocked.current,
		discardDraft: () => {
			discarded.current = true;
			writePageDraft(draftKey, undefined);
		},
		hasLocalDraft: () => {
			const draft = readPageDraft(draftKey, isDocumentDraft);
			return !!draft && sameDocument(draft.document, present.current);
		},
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
