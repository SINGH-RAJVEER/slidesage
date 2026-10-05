import { useAuth } from "@slidesage/ui";
import { type SetStateAction, useCallback, useEffect, useRef, useState } from "react";

export function pageDraftKey(userId: string | undefined, section: string): string {
	return `slidesage.draft.v1:${encodeURIComponent(userId ?? "anonymous")}:${section}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPageDraft<T>(
	key: string,
	valid: (value: unknown) => value is T,
): T | undefined {
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return undefined;
		const value: unknown = JSON.parse(raw);
		return valid(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

export function writePageDraft(key: string, value: unknown): boolean {
	try {
		if (value === undefined) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

/** Save changes immediately, so a navigation in the same event cannot lose them. */
export function usePageDraft<T>(
	section: string,
	initial: T,
	valid: (value: unknown) => value is T,
	seedKey?: string,
): [T, (value: SetStateAction<T>) => void] {
	const { user } = useAuth();
	const key = pageDraftKey(user?.id, section);
	const load = () => {
		const stored = readPageDraft(
			key,
			(value): value is { value: T; seedKey?: string } => isRecord(value) && valid(value["value"]),
		);
		const owner = crypto.randomUUID();
		return stored && (!seedKey || stored.seedKey === seedKey)
			? { value: stored.value, storageSeed: stored.seedKey, owner }
			: { value: initial, storageSeed: seedKey, owner };
	};
	const [state, setState] = useState(() => ({ key, seedKey, ...load() }));
	const current = useRef(state);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	if (state.key !== key || state.seedKey !== seedKey) {
		const next = { key, seedKey, ...load() };
		current.current = next;
		setState(next);
	} else {
		current.current = state;
	}
	const setValue = useCallback((action: SetStateAction<T>) => {
		const previous = current.current;
		const stored = readPageDraft(previous.key, isRecord);
		// A response from an unmounted page must not overwrite a newer draft.
		if (!mounted.current && stored && stored["owner"] !== previous.owner) return;
		const value =
			typeof action === "function" ? (action as (value: T) => T)(previous.value) : action;
		const next = { ...previous, value };
		writePageDraft(previous.key, { value, seedKey: previous.storageSeed, owner: previous.owner });
		current.current = next;
		if (mounted.current) setState(next);
	}, []);
	useEffect(() => {
		writePageDraft(state.key, {
			value: state.value,
			seedKey: state.storageSeed,
			owner: state.owner,
		});
	}, [state]);
	return [current.current.value, setValue];
}
