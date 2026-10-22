import Header from "../../app/Header";
import { AdRewardsPreference } from "./AdRewardsPreference";
import { AISettings } from "./AISettings";
import { LandingPreference } from "./LandingPreference";

export default function SettingsPage() {
	return (
		<div className="flex min-h-screen flex-col bg-transparent">
			<Header />
			<main className="flex-1 px-4 py-8 desktop:px-8 desktop:py-12">
				<div className="mx-auto w-full max-w-3xl space-y-10">
					<LandingPreference />
					<AdRewardsPreference />
					<div className="border-t border-white/10 pt-10">
						<AISettings />
					</div>
				</div>
			</main>
		</div>
	);
}
