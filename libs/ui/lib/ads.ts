import { AD_FREE_POINTS } from "@slidesage/types";

export const AD_PLACEMENTS = ["generate", "presentations", "marketplace", "anchor"] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export interface AdsConfig {
	clientId: string;
	slots: Partial<Record<AdPlacement, string>>;
}

export interface AdsEnv {
	VITE_ADSENSE_CLIENT_ID?: string;
	VITE_ADSENSE_SLOT_GENERATE?: string;
	VITE_ADSENSE_SLOT_PRESENTATIONS?: string;
	VITE_ADSENSE_SLOT_MARKETPLACE?: string;
	VITE_ADSENSE_SLOT_ANCHOR?: string;
}

const ADSENSE_SCRIPT_URL = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
const CLIENT_ID_PATTERN = /^ca-pub-\d{10,20}$/;
const SLOT_ID_PATTERN = /^\d{1,20}$/;

const readAdsEnv = (): AdsEnv => {
	try {
		if (typeof import.meta !== "undefined" && import.meta?.env) {
			const env = import.meta.env;
			return {
				VITE_ADSENSE_CLIENT_ID: env["VITE_ADSENSE_CLIENT_ID"],
				VITE_ADSENSE_SLOT_GENERATE: env["VITE_ADSENSE_SLOT_GENERATE"],
				VITE_ADSENSE_SLOT_PRESENTATIONS: env["VITE_ADSENSE_SLOT_PRESENTATIONS"],
				VITE_ADSENSE_SLOT_MARKETPLACE: env["VITE_ADSENSE_SLOT_MARKETPLACE"],
				VITE_ADSENSE_SLOT_ANCHOR: env["VITE_ADSENSE_SLOT_ANCHOR"],
			};
		}
	} catch {}
	try {
		if (typeof process !== "undefined" && process?.env) {
			const env = process.env;
			return {
				VITE_ADSENSE_CLIENT_ID: env["VITE_ADSENSE_CLIENT_ID"],
				VITE_ADSENSE_SLOT_GENERATE: env["VITE_ADSENSE_SLOT_GENERATE"],
				VITE_ADSENSE_SLOT_PRESENTATIONS: env["VITE_ADSENSE_SLOT_PRESENTATIONS"],
				VITE_ADSENSE_SLOT_MARKETPLACE: env["VITE_ADSENSE_SLOT_MARKETPLACE"],
				VITE_ADSENSE_SLOT_ANCHOR: env["VITE_ADSENSE_SLOT_ANCHOR"],
			};
		}
	} catch {}
	return {};
};

/**
 * Reads the AdSense publisher and the ad unit for each placement. Without a
 * valid publisher there are no ads at all, which is how development, tests,
 * and preview builds run. A placement without a valid unit stays empty.
 */
export function readAdsConfig(env: AdsEnv = readAdsEnv()): AdsConfig | null {
	const clientId = env.VITE_ADSENSE_CLIENT_ID?.trim() ?? "";
	if (!CLIENT_ID_PATTERN.test(clientId)) return null;

	const units: Record<AdPlacement, string | undefined> = {
		generate: env.VITE_ADSENSE_SLOT_GENERATE,
		presentations: env.VITE_ADSENSE_SLOT_PRESENTATIONS,
		marketplace: env.VITE_ADSENSE_SLOT_MARKETPLACE,
		anchor: env.VITE_ADSENSE_SLOT_ANCHOR,
	};
	const slots: AdsConfig["slots"] = {};
	for (const placement of AD_PLACEMENTS) {
		const slot = units[placement]?.trim();
		if (slot && SLOT_ID_PATTERN.test(slot)) slots[placement] = slot;
	}
	return { clientId, slots };
}

export const ADS_CONFIG = readAdsConfig();

/** Ads follow the current balance, so spending below the threshold brings them back. */
export function isAdEligible(slideTokens: number | null | undefined): boolean {
	return (
		typeof slideTokens === "number" && Number.isFinite(slideTokens) && slideTokens < AD_FREE_POINTS
	);
}

declare global {
	interface Window {
		adsbygoogle?: unknown[];
	}
}

let scriptLoad: Promise<void> | null = null;

/**
 * Adds the AdSense script the first time an ad is shown, so readers who never
 * see an ad never load it. A blocked script stays blocked for the page's life.
 */
export function loadAdScript(clientId: string): Promise<void> {
	if (scriptLoad) return scriptLoad;
	scriptLoad = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.async = true;
		script.crossOrigin = "anonymous";
		script.src = `${ADSENSE_SCRIPT_URL}?client=${encodeURIComponent(clientId)}`;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("The ad script could not load."));
		document.head.appendChild(script);
	});
	return scriptLoad;
}

/** Asks AdSense to fill the next unfilled ad unit on the page. */
export function requestAd() {
	window.adsbygoogle = window.adsbygoogle ?? [];
	window.adsbygoogle.push({});
}
