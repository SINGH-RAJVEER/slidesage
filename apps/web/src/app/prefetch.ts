import { prefetchBalance } from "../routes/billing/billing-data";
import { prefetchLibrary } from "../routes/presentations/presentation-data";
import { prefetchAIConfiguration, prefetchProfile } from "../routes/settings/settings-data";
import { ROUTES } from "./router/paths";
import { routeModules } from "./router/route-modules";

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

interface RoutePrefetch {
	module?: () => Promise<unknown>;
	/** Reads the signed-in user's data the page opens with. */
	data?: () => void;
}

/* Routes absent here either render from data already in memory or are only
   reached after an action, never from a link a user hovers. */
const ROUTE_PREFETCHES: Record<string, RoutePrefetch> = {
	[ROUTES.landing]: { module: routeModules.landing },
	[ROUTES.generate]: { module: routeModules.generate },
	[ROUTES.research]: { module: routeModules.research },
	[ROUTES.marketplace]: { module: routeModules.marketplace },
	[ROUTES.presentations]: { module: routeModules.presentations, data: prefetchLibrary },
	[ROUTES.purchase]: { module: routeModules.purchase, data: prefetchBalance },
	[ROUTES.profile]: { data: prefetchProfile },
	[ROUTES.settings]: { data: prefetchAIConfiguration },
};

/** Loads a page's code and opening data before the user follows a link to it. */
export function prefetchRoute(path: string, { signedIn }: { signedIn: boolean }): void {
	const route = ROUTE_PREFETCHES[path];
	if (!route) return;
	if (route.module) prefetchModule(route.module);
	if (signedIn) route.data?.();
}
