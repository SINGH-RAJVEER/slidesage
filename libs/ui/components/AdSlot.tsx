import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import { useAdUnit } from "../hooks/useAds";
import { ADS_CONFIG, type AdPlacement, type AdsConfig, loadAdScript, requestAd } from "../lib/ads";
import { cn } from "../lib/utils";

export interface AdLinkProps {
	to: string;
	className?: string;
	children: ReactNode;
}

/** How long a unit waits for AdSense to answer before it is dropped. */
export const AD_ANSWER_TIMEOUT_MS = 15_000;

type AdState = "pending" | "filled" | "unavailable";

interface AdSlotProps {
	placement: AdPlacement;
	/** Height of the ad in CSS pixels. */
	height: number;
	/** The widest ad the slot takes; a narrower container gets a narrower ad. */
	maxWidth: number;
	purchaseHref: string;
	LinkComponent: ComponentType<AdLinkProps>;
	/** Applied once an ad is showing. */
	className?: string;
	/** Called once AdSense has delivered an ad. */
	onFilled?: () => void;
	/** Called once the ad is blocked, unfilled, or never answered. */
	onUnavailable?: () => void;
	answerTimeoutMs?: number;
	config?: AdsConfig | null;
}

/**
 * One AdSense unit for a reader below the ad-free balance. It renders nothing
 * when ads are off. While AdSense decides, the unit stays invisible, out of the
 * layout, and hidden from assistive technology; it appears with its label only
 * once an ad is delivered, and is removed when the ad is blocked, unfilled, or
 * never answered, so a page without an ad looks like an ad-free page.
 */
export function AdSlot({
	placement,
	height,
	maxWidth,
	purchaseHref,
	LinkComponent,
	className,
	onFilled,
	onUnavailable,
	answerTimeoutMs = AD_ANSWER_TIMEOUT_MS,
	config = ADS_CONFIG,
}: AdSlotProps) {
	const unit = useAdUnit(placement, config);
	const [state, setState] = useState<AdState>("pending");
	const insRef = useRef<HTMLModElement>(null);
	// Each unit is filled once; Strict Mode runs the effect twice on one element.
	const requested = useRef(false);
	const callbacks = useRef({ onFilled, onUnavailable });
	callbacks.current = { onFilled, onUnavailable };
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
				if (!cancelled) setState("unavailable");
			},
		);
		return () => {
			cancelled = true;
		};
	}, [clientId]);

	// AdSense marks the unit filled or unfilled once it has answered. Ad blockers
	// and failed requests can leave it unanswered, so the wait is bounded.
	useEffect(() => {
		const ins = insRef.current;
		if (!clientId || !ins) return;
		const read = () => {
			const status = ins.getAttribute("data-ad-status");
			if (status === "filled") setState("filled");
			else if (status === "unfilled") setState("unavailable");
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
		const timer = setTimeout(
			() => setState((current) => (current === "pending" ? "unavailable" : current)),
			answerTimeoutMs,
		);
		return () => {
			observer.disconnect();
			clearTimeout(timer);
		};
	}, [clientId, answerTimeoutMs]);

	useEffect(() => {
		if (state === "filled") callbacks.current.onFilled?.();
		if (state === "unavailable") callbacks.current.onUnavailable?.();
	}, [state]);

	if (!unit || state === "unavailable") return null;
	const filled = state === "filled";

	return (
		<aside
			aria-label="Advertisement"
			aria-hidden={filled ? undefined : true}
			inert={!filled}
			data-ad-placement={placement}
			data-ad-state={state}
			className={cn(
				"mx-auto flex w-full flex-col gap-1.5",
				// Out of the flow, so no margin, grid cell, or gap shows, and
				// transparent, but at full size: AdSense sizes the ad it requests
				// from the unit and skips units without a width.
				filled ? className : "pointer-events-none absolute inset-x-0 bottom-0 opacity-0",
			)}
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
