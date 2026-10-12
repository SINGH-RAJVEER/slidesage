import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import { useAdUnit } from "../hooks/useAds";
import { ADS_CONFIG, type AdPlacement, type AdsConfig, loadAdScript, requestAd } from "../lib/ads";
import { cn } from "../lib/utils";

export interface AdLinkProps {
	to: string;
	className?: string;
	children: ReactNode;
}

interface AdSlotProps {
	placement: AdPlacement;
	/** Height of the ad in CSS pixels, reserved while it loads. */
	height: number;
	/** The widest ad the slot takes; a narrower container gets a narrower ad. */
	maxWidth: number;
	purchaseHref: string;
	LinkComponent: ComponentType<AdLinkProps>;
	className?: string;
	/** Called once the ad is blocked or AdSense has nothing to show. */
	onUnavailable?: () => void;
	config?: AdsConfig | null;
}

/**
 * One AdSense unit for a reader below the ad-free balance. It renders nothing
 * when ads are off, and removes itself when the ad is blocked or unfilled so
 * no empty space is left behind.
 */
export function AdSlot({
	placement,
	height,
	maxWidth,
	purchaseHref,
	LinkComponent,
	className,
	onUnavailable,
	config = ADS_CONFIG,
}: AdSlotProps) {
	const unit = useAdUnit(placement, config);
	const [unavailable, setUnavailable] = useState(false);
	const insRef = useRef<HTMLModElement>(null);
	// Each unit is filled once; Strict Mode runs the effect twice on one element.
	const requested = useRef(false);
	const clientId = unit?.clientId;

	useEffect(() => {
		if (!clientId) return;
		let cancelled = false;
		loadAdScript(clientId).then(
			() => {
				if (cancelled || requested.current || !insRef.current) return;
				requested.current = true;
				requestAd();
			},
			() => {
				if (!cancelled) setUnavailable(true);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	// AdSense marks the unit filled or unfilled once it has answered.
	useEffect(() => {
		const ins = insRef.current;
		if (!clientId || !ins) return;
		const observer = new MutationObserver(() => {
			if (ins.getAttribute("data-ad-status") === "unfilled") setUnavailable(true);
		});
		observer.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
		return () => observer.disconnect();
	}, [clientId]);

	useEffect(() => {
		if (unavailable) onUnavailable?.();
	}, [unavailable, onUnavailable]);

	if (!unit || unavailable) return null;

	return (
		<aside
			aria-label="Advertisement"
			data-ad-placement={placement}
			className={cn("mx-auto flex w-full flex-col gap-1.5", className)}
			style={{ maxWidth }}
		>
			<ins
				ref={insRef}
				className="adsbygoogle"
				style={{ display: "block", width: "100%", height }}
				data-ad-client={unit.clientId}
				data-ad-slot={unit.slot}
			/>
			<div className="flex items-center justify-between text-[11px] leading-none text-white/35">
				<span>Sponsored</span>
				<LinkComponent
					to={purchaseHref}
					className="underline decoration-white/20 underline-offset-2 transition-colors hover:text-white/70"
				>
					Remove ads
				</LinkComponent>
			</div>
		</aside>
	);
}
