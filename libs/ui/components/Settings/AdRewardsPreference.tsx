import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { Switch } from "@slidesage/ui/components/switch";
import { useState } from "react";

interface AdRewardsPreferenceProps {
	value: boolean;
	onSave: (show: boolean) => Promise<void>;
}

export function AdRewardsPreference({ value, onSave }: AdRewardsPreferenceProps) {
	const [busy, setBusy] = useState(false);
	const [optimistic, setOptimistic] = useState<boolean | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const change = async (show: boolean) => {
		setBusy(true);
		setError(null);
		setMessage(null);
		setOptimistic(show);
		try {
			await onSave(show);
			setMessage(show ? "Ad rewards shown on the purchase page." : "Ad rewards hidden.");
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : String(saveError));
		} finally {
			setOptimistic(null);
			setBusy(false);
		}
	};

	return (
		<section>
			<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
				Ad rewards
			</div>
			<div className="mt-2 flex items-center justify-between gap-6">
				<div>
					<h2 className="text-lg font-semibold text-white">Offer ads for points</h2>
					<p className="mt-1 text-sm text-white/50">
						Show the option to watch a short ad for points next to your balance.
					</p>
				</div>
				<Switch
					aria-label="Offer ads for points"
					checked={optimistic ?? value}
					disabled={busy}
					onCheckedChange={(show) => void change(show)}
				/>
			</div>
			<FloatingNotice
				error={error}
				success={message}
				onDismiss={() => {
					setError(null);
					setMessage(null);
				}}
			/>
		</section>
	);
}
