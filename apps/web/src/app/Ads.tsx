import { AdSlot } from "@slidesage/ui/components/AdSlot";
import { useAdUnit } from "@slidesage/ui/hooks/useAds";
import { useMediaQuery } from "@slidesage/ui/hooks/useMediaQuery";
import type { AdPlacement } from "@slidesage/ui/lib/ads";
import { useState } from "react";
import { createPortal } from "react-dom";
import { PrefetchLink } from "./PrefetchLink";
import { ROUTES } from "./router/paths";

/** Below this width a page shows the anchored banner instead of its inline ad. */
export const DESKTOP_ADS_QUERY = "(min-width: 768px)";

interface InlineAdProps {
	placement: Exclude<AdPlacement, "anchor">;
	maxWidth: number;
	className?: string;
}

/** A 90 pixel tall ad in the page's flow, on desktop widths only. */
export function InlineAd({ placement, maxWidth, className }: InlineAdProps) {
	const desktop = useMediaQuery(DESKTOP_ADS_QUERY);
	if (!desktop) return null;
	return (
		<AdSlot
			placement={placement}
			height={90}
			maxWidth={maxWidth}
			purchaseHref={ROUTES.purchase}
			LinkComponent={PrefetchLink}
			className={className}
		/>
	);
}

/**
 * A 320 by 50 banner fixed to the bottom of the screen on mobile widths. Place
 * it at the end of the page's scrolling content: the spacer it leaves there
 * lets the last item scroll clear of the banner.
 */
export function AnchoredAd() {
	const desktop = useMediaQuery(DESKTOP_ADS_QUERY);
	const unit = useAdUnit("anchor");
	const [unavailable, setUnavailable] = useState(false);
	if (desktop || !unit || unavailable) return null;

	return (
		<>
			<div aria-hidden="true" className="h-24 shrink-0" />
			{createPortal(
				<div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[hsl(222,27%,12%)]/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
					<AdSlot
						placement="anchor"
						height={50}
						maxWidth={320}
						purchaseHref={ROUTES.purchase}
						LinkComponent={PrefetchLink}
						onUnavailable={() => setUnavailable(true)}
					/>
				</div>,
				document.body,
			)}
		</>
	);
}
