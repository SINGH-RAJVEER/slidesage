/** How long a prefetched answer waits for the page it was fetched for. */
export const PREFETCH_TTL_MS = 20_000;

interface Entry {
	promise: Promise<unknown>;
	expires: number;
}

const entries = new Map<string, Entry>();

function fresh(key: string): Entry | undefined {
	const entry = entries.get(key);
	if (!entry) return undefined;
	if (entry.expires > Date.now()) return entry;
	entries.delete(key);
	return undefined;
}

/**
 * Starts loading `key`, or joins a load already under way, and keeps the answer
 * for the page that is about to ask for it. A failed load is forgotten so the
 * page tries again.
 */
export function prefetch<T>(key: string, load: () => Promise<T>): Promise<T> {
	const entry = fresh(key);
	if (entry) return entry.promise as Promise<T>;

	const promise = load();
	entries.set(key, { promise, expires: Date.now() + PREFETCH_TTL_MS });
	promise.catch(() => {
		if (entries.get(key)?.promise === promise) entries.delete(key);
	});
	return promise;
}

/**
 * Hands a page the prefetched answer for `key`, or loads it, and forgets it
 * once it settles so the next visit loads current data. Callers that arrive
 * while it is still loading share it, as a page's effects do when React runs
 * them twice.
 */
export function takePrefetched<T>(key: string, load: () => Promise<T>): Promise<T> {
	const promise = prefetch(key, load);
	const forget = () => {
		if (entries.get(key)?.promise === promise) entries.delete(key);
	};
	promise.then(forget, forget);
	return promise;
}

/** Forgets every prefetched answer whose key starts with `prefix`. */
export function evictPrefetched(prefix: string): void {
	for (const key of entries.keys()) {
		if (key.startsWith(prefix)) entries.delete(key);
	}
}

export function clearPrefetched(): void {
	entries.clear();
}
