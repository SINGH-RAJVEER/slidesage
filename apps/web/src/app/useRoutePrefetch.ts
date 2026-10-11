import { useAuth } from "@slidesage/ui";
import { useLocation } from "react-router-dom";
import { prefetchRoute } from "./prefetch";

/** Returns a function that prefetches a path's page, skipping the page already open. */
export function useRoutePrefetch(): (path: string) => void {
	const { user } = useAuth();
	const { pathname } = useLocation();
	return (path) => {
		// The page already open has its data; nobody would collect a copy.
		if (path !== pathname) prefetchRoute(path, { signedIn: Boolean(user) });
	};
}
