let pendingModules = 0;

/** Whether a route's code is being loaded ahead of a click that may not come. */
export function isModulePrefetchPending(): boolean {
	return pendingModules > 0;
}

/**
 * Loads a route's code before the user opens it. A failure is dropped: the
 * click that follows loads the module again and reports or recovers then.
 */
export function prefetchModule(load: () => Promise<unknown>): void {
	pendingModules += 1;
	load()
		.catch(() => {})
		.finally(() => {
			pendingModules -= 1;
		});
}
