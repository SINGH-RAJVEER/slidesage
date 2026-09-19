/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

class MockAuthError extends Error {
	readonly status: number;
	readonly code: string | undefined;

	constructor(message: string, status: number, code?: string) {
		super(message);
		this.name = "AuthError";
		this.status = status;
		this.code = code;
	}
}

const requestPasswordReset = mock(async () => {
	throw new MockAuthError(
		"No account exists for this email address. Create an account to continue.",
		404,
		"ACCOUNT_NOT_FOUND",
	);
});

mock.module("@slidesage/ui/context/AuthContext", () => ({
	useAuth: () => ({
		isSignedIn: false,
		refreshSession: mock(),
		user: null,
	}),
}));

mock.module("@slidesage/ui/lib/auth-client", () => ({
	auth: {
		requestPasswordReset,
	},
}));

it("points an unknown email at sign-up instead of the code screen", async () => {
	requestPasswordReset.mockClear();
	const { default: ForgotPasswordPage } = await import("../../../routes/auth/ForgotPasswordPage");
	const view = render(
		<MemoryRouter initialEntries={["/forgot-password"]}>
			<Routes>
				<Route path="/forgot-password" element={<ForgotPasswordPage />} />
				<Route path="/reset-password" element={<span>reset code screen</span>} />
			</Routes>
		</MemoryRouter>,
	);

	fireEvent.change(view.getByLabelText("Email"), { target: { value: "Nobody@Example.com" } });
	fireEvent.submit(view.getByRole("button", { name: "Send reset code" }));

	await waitFor(() => {
		expect(view.getByText("Create an account")).toBeTruthy();
	});
	expect(requestPasswordReset).toHaveBeenCalledWith({ email: "nobody@example.com" });
	expect(view.queryByText("reset code screen")).toBeNull();
});
