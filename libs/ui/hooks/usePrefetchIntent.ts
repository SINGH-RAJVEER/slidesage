import { type PointerEvent, useEffect, useMemo, useRef } from "react";

/** How long a mouse has to rest on a target before it counts as intent. */
export const PREFETCH_INTENT_DELAY_MS = 100;

export interface PrefetchIntentHandlers {
	onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
	onPointerLeave: () => void;
	onPointerDown: () => void;
	onFocus: () => void;
}

/**
 * Calls `prefetch` once the user shows they are about to open a target: a mouse
 * resting on it, a touch starting on it, or keyboard focus reaching it. A mouse
 * passing over on its way elsewhere does not count.
 */
export function usePrefetchIntent(prefetch: (() => void) | undefined): PrefetchIntentHandlers {
	const latest = useRef(prefetch);
	latest.current = prefetch;
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const handlers = useMemo<PrefetchIntentHandlers>(() => {
		const cancel = () => {
			clearTimeout(timer.current);
			timer.current = undefined;
		};
		const fire = () => {
			cancel();
			latest.current?.();
		};
		return {
			onPointerEnter: (event) => {
				// Touch and pen report intent through pointerdown instead.
				if (event.pointerType !== "mouse") return;
				cancel();
				timer.current = setTimeout(fire, PREFETCH_INTENT_DELAY_MS);
			},
			onPointerLeave: cancel,
			onPointerDown: fire,
			onFocus: fire,
		};
	}, []);

	useEffect(() => () => clearTimeout(timer.current), []);

	return handlers;
}

/**
 * Merges intent handlers into props that may already carry their own, as a
 * Radix `asChild` parent passes to the element it wraps.
 */
export function withPrefetchIntent<
	P extends Partial<Record<keyof PrefetchIntentHandlers, unknown>>,
>(props: P, intent: PrefetchIntentHandlers): P {
	const merged: Record<string, unknown> = { ...props };
	for (const name of ["onPointerEnter", "onPointerLeave", "onPointerDown", "onFocus"] as const) {
		const own = props[name];
		const handler = intent[name] as (event: unknown) => void;
		merged[name] = (event: unknown) => {
			if (typeof own === "function") own(event);
			handler(event);
		};
	}
	return merged as P;
}
