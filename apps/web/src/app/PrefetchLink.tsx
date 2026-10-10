import { usePrefetchIntent, withPrefetchIntent } from "@slidesage/ui/hooks/usePrefetchIntent";
import type { Ref } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { useRoutePrefetch } from "./useRoutePrefetch";

type PrefetchLinkProps = LinkProps & { ref?: Ref<HTMLAnchorElement> };

/** A link that loads its page's code and data once the user looks about to follow it. */
export function PrefetchLink(props: PrefetchLinkProps) {
	const prefetchPath = useRoutePrefetch();
	const path = typeof props.to === "string" ? props.to : props.to.pathname;
	const intent = usePrefetchIntent(() => {
		if (path) prefetchPath(path);
	});
	return <Link {...withPrefetchIntent(props, intent)} />;
}
