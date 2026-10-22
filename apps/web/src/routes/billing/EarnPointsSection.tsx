import type {
	AdRewardClaimResponse,
	AdRewardReason,
	AdRewardSessionResponse,
	AdRewardStatusResponse,
	ApiErrorResponse,
} from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { API_URL, getJson, readJsonResponse } from "@slidesage/ui/lib/api";
import { publishPointsBalance } from "@slidesage/ui/lib/points";
import { PlayCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { showRewardedAd } from "./rewarded-ad";

type EnabledStatus = Extract<AdRewardStatusResponse, { enabled: true }>;
type Phase = "idle" | "loading" | "watching" | "claiming";

const REASON_MESSAGES: Record<AdRewardReason, string> = {
	email_unverified: "Verify your email to earn points from ads.",
	account_too_new: "New accounts can earn points from ads after their first day.",
	daily_cap: "You have earned today's ad points. Come back tomorrow.",
	monthly_cap: "You have earned this month's ad points.",
	cooldown: "Your next ad will be ready in a moment.",
};

/** Refetch status when a cooldown ends, but not for waits measured in days. */
const MAX_STATUS_REFRESH_MS = 10 * 60 * 1000;

interface EarnPointsSectionProps {
	onBalance(balance: number): void;
	onError(message: string): void;
	onSuccess(message: string): void;
}

class AdRewardError extends Error {
	readonly code?: string;
	readonly retryAfterSeconds?: number;

	constructor(message: string, code?: string, retryAfterSeconds?: number) {
		super(message);
		this.code = code;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

async function postJson<T>(path: string): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, { method: "POST", credentials: "include" });
	const body = await readJsonResponse<T | (ApiErrorResponse & { retry_after?: number })>(response);
	if (!response.ok || body === null || (typeof body === "object" && "error" in body)) {
		const failure = body && typeof body === "object" && "error" in body ? body : null;
		throw new AdRewardError(
			failure?.error.message ?? "Ad reward request failed",
			failure?.error.code,
			failure?.retry_after,
		);
	}
	return body as T;
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, milliseconds)));
}

/** Claims a watched view, retrying once if the server says the minimum watch time has not passed. */
async function claimSession(sessionID: string): Promise<AdRewardClaimResponse> {
	const path = `/rewards/ads/sessions/${encodeURIComponent(sessionID)}/claim`;
	try {
		return await postJson<AdRewardClaimResponse>(path);
	} catch (error) {
		if (!(error instanceof AdRewardError) || error.code !== "AD_REWARD_TOO_EARLY") throw error;
		await sleep((error.retryAfterSeconds ?? 1) * 1000);
		return postJson<AdRewardClaimResponse>(path);
	}
}

/** Offers an opt-in rewarded ad. Renders nothing while ad rewards are off. */
export default function EarnPointsSection({
	onBalance,
	onError,
	onSuccess,
}: EarnPointsSectionProps) {
	const [status, setStatus] = useState<EnabledStatus | null>(null);
	const [phase, setPhase] = useState<Phase>("idle");

	const refresh = useCallback(async () => {
		const result = await getJson<AdRewardStatusResponse>("/rewards/ads");
		setStatus(result.ok && result.data.enabled ? result.data : null);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!status?.next_available_at) return;
		const delay = new Date(status.next_available_at).getTime() - Date.now();
		if (delay > MAX_STATUS_REFRESH_MS) return;
		const timer = window.setTimeout(() => void refresh(), Math.max(0, delay) + 500);
		return () => window.clearTimeout(timer);
	}, [status, refresh]);

	if (!status) return null;

	const watch = async () => {
		setPhase("loading");
		// Set inside the ad callback, so held in an object TypeScript does not narrow.
		const issued: { session?: AdRewardSessionResponse; receivedAt?: number } = {};
		try {
			const outcome = await showRewardedAd(status.ad_unit, async () => {
				issued.session = await postJson<AdRewardSessionResponse>("/rewards/ads/sessions");
				issued.receivedAt = Date.now();
				setPhase("watching");
			});
			if (outcome === "unavailable") {
				onError("No ad is available right now. Try again later.");
			} else if (outcome === "dismissed") {
				onError("Watch the whole ad to earn points.");
			} else if (issued.session) {
				setPhase("claiming");
				// The server refuses claims before the minimum watch time. Timing it
				// from local receipt, not the server timestamp, ignores clock skew.
				await sleep((issued.receivedAt ?? 0) + status.min_watch_seconds * 1000 - Date.now());
				const claim = await claimSession(issued.session.session_id);
				onBalance(claim.new_balance);
				publishPointsBalance(claim.new_balance);
				onSuccess(`${claim.points_awarded} points added to your account!`);
			}
		} catch (error) {
			onError(error instanceof Error ? error.message : "Could not reward this ad");
		} finally {
			setPhase("idle");
			void refresh();
		}
	};

	const busy = phase !== "idle";
	const label =
		phase === "loading"
			? "Loading ad..."
			: phase === "idle"
				? `Watch ad for ${status.points_per_view} points`
				: "Adding points...";

	return (
		<section
			aria-labelledby="earn-points-heading"
			className="flex flex-col items-center justify-center gap-3 text-center desktop:ml-16 desktop:border-l desktop:border-white/10 desktop:pl-16"
		>
			<h2
				id="earn-points-heading"
				className="text-white/40 text-sm uppercase tracking-widest font-medium"
			>
				Earn points
			</h2>
			<Button
				className="h-11 border border-white/10 bg-white/5 px-6 font-semibold text-white backdrop-blur-lg hover:bg-white/10"
				onClick={() => void watch()}
				disabled={!status.eligible || busy}
			>
				<PlayCircle className="mr-2 h-4 w-4" />
				{label}
			</Button>
			<p className="text-white/40 text-xs">
				{status.reason
					? REASON_MESSAGES[status.reason]
					: `${status.views_left_today} left today, ${status.points_left_this_month} points left this month`}
			</p>
		</section>
	);
}
