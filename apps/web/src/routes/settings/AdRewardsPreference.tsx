import type { AdRewardStatusResponse } from "@slidesage/types";
import { useAuth } from "@slidesage/ui";
import { AdRewardsPreference as AdRewardsPreferenceView } from "@slidesage/ui/components/Settings/AdRewardsPreference";
import { API_URL, getJson, readJsonResponse } from "@slidesage/ui/lib/api";
import { useEffect, useState } from "react";

/** The ad rewards toggle, shown only while the server offers ad rewards. */
export function AdRewardsPreference() {
	const { user, refreshSession } = useAuth();
	const [available, setAvailable] = useState(false);

	useEffect(() => {
		let active = true;
		void getJson<AdRewardStatusResponse>("/rewards/ads").then((result) => {
			if (active) setAvailable(result.ok && result.data.enabled);
		});
		return () => {
			active = false;
		};
	}, []);

	if (!available) return null;

	const save = async (showAdRewards: boolean) => {
		const response = await fetch(`${API_URL}/profile`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ showAdRewards }),
		});
		if (!response.ok) {
			const result = await readJsonResponse<{ error?: { message?: string } }>(response);
			throw new Error(result?.error?.message || "Failed to update ad rewards");
		}
		await refreshSession({ force: true });
	};

	return (
		<div className="border-t border-white/10 pt-10">
			<AdRewardsPreferenceView value={user?.showAdRewards !== false} onSave={save} />
		</div>
	);
}
