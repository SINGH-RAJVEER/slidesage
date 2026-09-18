import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WordmarkOrb } from "../../../routes/landing/WordmarkOrb";

function renderOrb() {
	return render(
		<MemoryRouter>
			<WordmarkOrb />
		</MemoryRouter>,
	);
}

describe("WordmarkOrb", () => {
	it("is a link that leads to sign-up", () => {
		const { getByRole } = renderOrb();
		const link = getByRole("link", { name: "SlideSage — sign up" });
		expect(link).toHaveAttribute("href", "/sign-up");
	});

	it("layers the WebGL black hole over the star field", () => {
		const { container } = renderOrb();
		expect(container.querySelectorAll("canvas")).toHaveLength(2);
	});

	it("falls back to a CSS black hole when WebGL is unavailable", () => {
		/* happy-dom has no WebGL context, so the effect takes the fallback path. */
		const { container, getByRole } = renderOrb();
		expect(container.querySelector("[data-black-hole-fallback]")).not.toBeNull();
		expect(getByRole("link", { name: "SlideSage — sign up" })).toHaveAttribute("href", "/sign-up");
	});
});
