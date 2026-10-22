// Google Publisher Tag rewarded ads. GPT is loaded only when a user asks to
// watch an ad, never on page load, and only the members used here are typed.

interface GoogleSlot {
	addService(service: GooglePubAds): GoogleSlot;
}

interface RewardedSlotEvent {
	slot: GoogleSlot;
}

interface RewardedSlotReadyEvent extends RewardedSlotEvent {
	makeRewardedVisible(): void;
}

type RewardedEventName = "rewardedSlotReady" | "rewardedSlotGranted" | "rewardedSlotClosed";

interface GooglePubAds {
	addEventListener(
		name: RewardedEventName,
		listener: (event: RewardedSlotReadyEvent) => void,
	): void;
	removeEventListener(
		name: RewardedEventName,
		listener: (event: RewardedSlotReadyEvent) => void,
	): void;
}

interface GoogleTag {
	cmd: { push(callback: () => void): void };
	enums: { OutOfPageFormat: { REWARDED: number } };
	defineOutOfPageSlot(adUnitPath: string, format: number): GoogleSlot | null;
	pubads(): GooglePubAds;
	enableServices(): void;
	display(slot: GoogleSlot): void;
	destroySlots(slots?: GoogleSlot[]): boolean;
}

declare global {
	interface Window {
		googletag?: GoogleTag;
	}
}

const GPT_SOURCE = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";

/** How long to wait for an ad to fill before reporting that none is available. */
const READY_TIMEOUT_MS = 8000;

/** granted: the ad network says the reward was earned. dismissed: closed before that. */
export type RewardedAdOutcome = "granted" | "dismissed" | "unavailable";

let gptLoad: Promise<GoogleTag> | null = null;

function loadGpt(): Promise<GoogleTag> {
	if (gptLoad) return gptLoad;
	gptLoad = new Promise<GoogleTag>((resolve, reject) => {
		window.googletag = window.googletag ?? ({ cmd: [] } as unknown as GoogleTag);
		const script = document.createElement("script");
		script.src = GPT_SOURCE;
		script.async = true;
		script.crossOrigin = "anonymous";
		script.onload = () => {
			const googletag = window.googletag;
			if (googletag) googletag.cmd.push(() => resolve(googletag));
			else reject(new Error("Ad script did not start"));
		};
		// Ad blockers land here; a later attempt may load once they are off.
		script.onerror = () => {
			gptLoad = null;
			reject(new Error("Ad script failed to load"));
		};
		document.head.appendChild(script);
	});
	return gptLoad;
}

/**
 * Shows one rewarded ad. beforeShow runs once an ad has filled and must
 * resolve before the ad becomes visible, so the server's ad session exists
 * before the view starts. If it rejects, the ad is discarded unseen and the
 * rejection propagates.
 */
export async function showRewardedAd(
	adUnit: string,
	beforeShow: () => Promise<void>,
): Promise<RewardedAdOutcome> {
	let googletag: GoogleTag;
	try {
		googletag = await loadGpt();
	} catch {
		return "unavailable";
	}
	return new Promise<RewardedAdOutcome>((resolve, reject) => {
		// GPT returns null where the rewarded format is unsupported.
		const slot = googletag.defineOutOfPageSlot(adUnit, googletag.enums.OutOfPageFormat.REWARDED);
		if (!slot) {
			resolve("unavailable");
			return;
		}
		const pubads = googletag.pubads();
		let granted = false;
		let settled = false;
		const finish = (outcome: RewardedAdOutcome | Error) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			pubads.removeEventListener("rewardedSlotReady", onReady);
			pubads.removeEventListener("rewardedSlotGranted", onGranted);
			pubads.removeEventListener("rewardedSlotClosed", onClosed);
			googletag.destroySlots([slot]);
			if (outcome instanceof Error) reject(outcome);
			else resolve(outcome);
		};
		const onReady = (event: RewardedSlotReadyEvent) => {
			if (event.slot !== slot) return;
			window.clearTimeout(timer);
			beforeShow().then(
				() => event.makeRewardedVisible(),
				(error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
			);
		};
		const onGranted = (event: RewardedSlotEvent) => {
			if (event.slot === slot) granted = true;
		};
		const onClosed = (event: RewardedSlotEvent) => {
			if (event.slot === slot) finish(granted ? "granted" : "dismissed");
		};
		const timer = window.setTimeout(() => finish("unavailable"), READY_TIMEOUT_MS);
		pubads.addEventListener("rewardedSlotReady", onReady);
		pubads.addEventListener("rewardedSlotGranted", onGranted);
		pubads.addEventListener("rewardedSlotClosed", onClosed);
		slot.addService(pubads);
		googletag.enableServices();
		googletag.display(slot);
	});
}
