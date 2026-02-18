/// <reference lib="dom" />

import { describe, expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";

mock.module("@clerk/clerk-react", () => {
	return {
		useUser: () => ({ user: null }),
		UserButton: () => null,
	};
});

describe("Header", () => {
	it("renders header component", async () => {
		// Import after mocking Clerk.
		const { default: Header } = await import("../../components/Header");

		const { container } = render(
			<BrowserRouter>
				<Header />
			</BrowserRouter>,
		);

		// Header should be present
		const header = container.querySelector("header");
		expect(header).toBeInTheDocument();
	});

	it("hides navigation tabs on auth pages", async () => {
		// Import after mocking Clerk.
		const { default: Header } = await import("../../components/Header");

		const { queryByText } = render(
			<MemoryRouter initialEntries={["/sign-in"]}>
				<Header />
			</MemoryRouter>,
		);

		expect(queryByText("Generate")).toBeNull();
		expect(queryByText("Presentations")).toBeNull();
	});

	it("hides navigation tabs on nested auth pages", async () => {
		// Import after mocking Clerk.
		const { default: Header } = await import("../../components/Header");

		const { queryByText, rerender } = render(
			<MemoryRouter initialEntries={["/sign-in/sso-callback"]}>
				<Header />
			</MemoryRouter>,
		);

		expect(queryByText("Generate")).toBeNull();
		expect(queryByText("Presentations")).toBeNull();

		rerender(
			<MemoryRouter initialEntries={["/sign-up/verify-email"]}>
				<Header />
			</MemoryRouter>,
		);

		expect(queryByText("Generate")).toBeNull();
		expect(queryByText("Presentations")).toBeNull();
	});
});
