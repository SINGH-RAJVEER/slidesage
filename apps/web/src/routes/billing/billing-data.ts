import type { BillingBalanceResponse } from "@slidesage/types";
import { getJson } from "@slidesage/ui/lib/api";
import { prefetch, takePrefetched } from "@slidesage/ui/lib/prefetch";

const BALANCE_KEY = "billing:balance";

/** The points balance, or null when it could not be read. */
async function fetchBalance(): Promise<BillingBalanceResponse | null> {
	const result = await getJson<BillingBalanceResponse>("/billing/balance");
	return result.ok ? result.data : null;
}

export function prefetchBalance(): void {
	prefetch(BALANCE_KEY, fetchBalance).catch(() => {});
}

/** The points balance, prefetched if the user hovered their way here. */
export function takeBalance(): Promise<BillingBalanceResponse | null> {
	return takePrefetched(BALANCE_KEY, fetchBalance);
}
