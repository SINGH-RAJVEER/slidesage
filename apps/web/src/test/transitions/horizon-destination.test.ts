import { describe, expect, it } from "bun:test";
import { hasSignedInBefore, rememberSignedIn } from "@slidesage/ui/lib/session-history";
import { horizonDestination } from "../../app/transitions/horizon-destination";

describe("horizon destination", () => {
	it("separates new and returning signed-out visitors", () => {
		expect(horizonDestination(false, undefined, false)).toBe("/sign-up");
		expect(horizonDestination(false, undefined, true)).toBe("/sign-in");
	});
	it("honors signed-in defaults and sends landing defaults to Generate", () => {
		for (const page of [undefined, "generate", "landing"])
			expect(horizonDestination(true, page, false)).toBe("/generate");
		expect(horizonDestination(true, "presentations", true)).toBe("/presentations");
	});
	it("remembers a successful session without storing account data", () => {
		expect(hasSignedInBefore()).toBe(false);
		rememberSignedIn();
		expect(hasSignedInBefore()).toBe(true);
		expect(localStorage.getItem("slidesage-signed-in-before")).toBe("1");
	});
});
