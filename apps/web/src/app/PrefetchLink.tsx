import { useAuth } from "@slidesage/ui";
import { usePrefetchIntent, withPrefetchIntent } from "@slidesage/ui/hooks/usePrefetchIntent";
import type { Ref } from "react";
import { Link, type LinkProps, useLocation } from "react-router-dom";
import { prefetchRoute } from "./prefetch";

type PrefetchLinkProps = LinkProps & { ref?: Ref<HTMLAnchorElement> };

/** A link that loads its page's code and data once the user looks about to follow it. */
export function PrefetchLink(props: PrefetchLinkProps) {
	const { user } = useAuth();
	const { pathname } = useLocation();
	const path = typeof props.to === "string" ? props.to : props.to.pathname;
	const intent = usePrefetchIntent(() => {
		// The page already open has its data; nobody would collect a copy.
		if (path && path !== pathname) prefetchRoute(path, { signedIn: Boolean(user) });
	});
	return <Link {...withPrefetchIntent(props, intent)} />;
}
