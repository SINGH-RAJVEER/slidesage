import { useAuth } from "../context/AuthContext";
import { ADS_CONFIG, type AdPlacement, type AdsConfig, isAdEligible } from "../lib/ads";

/** Whether the signed-in reader sees ads. False until the session has loaded. */
export function useAdsEligible(): boolean {
	const { user, loading } = useAuth();
	return !loading && isAdEligible(user?.slideTokens);
}

export interface AdUnit {
	clientId: string;
	slot: string;
}

/** The ad unit to show at a placement, or null when the reader sees no ad there. */
export function useAdUnit(
	placement: AdPlacement,
	config: AdsConfig | null = ADS_CONFIG,
): AdUnit | null {
	const eligible = useAdsEligible();
	const slot = config?.slots[placement];
	return eligible && config && slot ? { clientId: config.clientId, slot } : null;
}
