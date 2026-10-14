import { MOBILE_MEDIA_QUERY } from "@slidesage/ui/lib/mobile";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
	if (typeof window === "undefined" || !window.matchMedia) return () => {};
	const query = window.matchMedia(MOBILE_MEDIA_QUERY);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

function isMobile() {
	if (typeof window === "undefined" || !window.matchMedia) return false;
	return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/** Whether the viewport gets the mobile layout. Follows rotation and resizing. */
export function useIsMobile() {
	return useSyncExternalStore(subscribe, isMobile, () => false);
}
