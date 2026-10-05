import { afterEach, describe, expect, it, mock, setSystemTime } from "bun:test";
import {
	clearPrefetched,
	evictPrefetched,
	PREFETCH_TTL_MS,
	prefetch,
	takePrefetched,
} from "../../lib/prefetch";

afterEach(() => {
	clearPrefetched();
	setSystemTime();
});

describe("prefetch", () => {
	it("joins a load already under way instead of starting another", async () => {
		const load = mock(async () => "deck");

		const first = prefetch("deck:1", load);
		const second = prefetch("deck:1", load);

		expect(second).toBe(first);
		expect(await second).toBe("deck");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("hands the answer to the pages waiting on it and then loads afresh", async () => {
		const prefetched = mock(async () => "prefetched");
		const direct = mock(async () => "direct");

		prefetch("deck:1", prefetched);
		const first = takePrefetched("deck:1", direct);
		const second = takePrefetched("deck:1", direct);

		expect(await first).toBe("prefetched");
		expect(await second).toBe("prefetched");
		expect(await takePrefetched("deck:1", direct)).toBe("direct");
		expect(prefetched).toHaveBeenCalledTimes(1);
		expect(direct).toHaveBeenCalledTimes(1);
	});

	it("drops an answer nobody took in time", async () => {
		const direct = mock(async () => "direct");
		setSystemTime(new Date("2026-10-06T10:00:00Z"));
		prefetch("deck:1", async () => "stale");

		setSystemTime(new Date(Date.parse("2026-10-06T10:00:00Z") + PREFETCH_TTL_MS + 1));

		expect(await takePrefetched("deck:1", direct)).toBe("direct");
	});

	it("forgets a failed load so the page tries again", async () => {
		const direct = mock(async () => "direct");
		await prefetch("deck:1", async () => Promise.reject(new Error("offline"))).catch(() => {});

		expect(await takePrefetched("deck:1", direct)).toBe("direct");
	});

	it("evicts every key under a prefix", async () => {
		const direct = mock(async () => "direct");
		prefetch("presentation:1:detail", async () => "detail");
		prefetch("presentation:1:document", async () => "document");
		prefetch("presentation:2:detail", async () => "other");

		evictPrefetched("presentation:1:");

		expect(await takePrefetched("presentation:1:detail", direct)).toBe("direct");
		expect(await takePrefetched("presentation:1:document", direct)).toBe("direct");
		expect(await takePrefetched("presentation:2:detail", direct)).toBe("other");
	});
});
