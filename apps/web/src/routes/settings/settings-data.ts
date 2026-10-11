import type { AIConfigurationResponse, ProfileResponse } from "@slidesage/types";
import { fetchAIConfiguration } from "@slidesage/ui/lib/ai-connections";
import { getJson } from "@slidesage/ui/lib/api";
import { prefetch, takePrefetched } from "@slidesage/ui/lib/prefetch";

const PROFILE_KEY = "profile";
const AI_CONFIGURATION_KEY = "ai:configuration";

async function fetchProfile(): Promise<ProfileResponse> {
	const result = await getJson<ProfileResponse>("/profile");
	if (!result.ok) throw new Error("Failed to load profile");
	return result.data;
}

export function prefetchProfile(): void {
	prefetch(PROFILE_KEY, fetchProfile).catch(() => {});
}

/** The signed-in user's profile, prefetched if they hovered their way here. */
export function takeProfile(): Promise<ProfileResponse> {
	return takePrefetched(PROFILE_KEY, fetchProfile);
}

export function prefetchAIConfiguration(): void {
	prefetch(AI_CONFIGURATION_KEY, fetchAIConfiguration).catch(() => {});
}

/** The AI settings, prefetched for the first read; later reads ask the server. */
export function takeAIConfiguration(): Promise<AIConfigurationResponse> {
	return takePrefetched(AI_CONFIGURATION_KEY, fetchAIConfiguration);
}
