import { describe, expect, it } from "bun:test";
import { isAdEligible, readAdsConfig } from "../../lib/ads";

describe("ad eligibility", () => {
	it("shows ads only below 250 points", () => {
		expect(isAdEligible(50)).toBe(true);
		expect(isAdEligible(249.999)).toBe(true);
		expect(isAdEligible(250)).toBe(false);
		expect(isAdEligible(625)).toBe(false);
	});

	it("shows no ads without a known balance", () => {
		expect(isAdEligible(null)).toBe(false);
		expect(isAdEligible(undefined)).toBe(false);
		expect(isAdEligible(Number.NaN)).toBe(false);
	});
});

describe("ads config", () => {
	it("turns ads off without a valid publisher", () => {
		expect(readAdsConfig({})).toBeNull();
		expect(readAdsConfig({ VITE_ADSENSE_CLIENT_ID: "pub-1234567890123456" })).toBeNull();
	});

	it("keeps only valid ad units", () => {
		expect(
			readAdsConfig({
				VITE_ADSENSE_CLIENT_ID: " ca-pub-1234567890123456 ",
				VITE_ADSENSE_SLOT_GENERATE: "1234567890",
				VITE_ADSENSE_SLOT_MARKETPLACE: "not-a-slot",
			}),
		).toEqual({ clientId: "ca-pub-1234567890123456", slots: { generate: "1234567890" } });
	});
});
