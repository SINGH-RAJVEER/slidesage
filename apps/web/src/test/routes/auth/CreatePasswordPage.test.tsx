/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const sendSignInOtp = mock(async () => ({ success: true }));
const signInEmailOtp = mock(async () => ({ token: "jwt", user: { id: "user_1" } }));
const refreshSession = mock(async () => {});

mock.module("@slidesage/ui/context/AuthContext", () => ({
	useAuth: () => ({
		isSignedIn: false,
		refreshSession,
		user: null,
	}),
}));

mock.module("@slidesage/ui/lib/auth-client", () => ({
	auth: {
		sendSignInOtp,
		signInEmailOtp,
	},
}));

it("saves the new password with the emailed code and signs in", async () => {
	const { default: CreatePasswordPage } = await import("../../../routes/auth/CreatePasswordPage");
	const view = render(
		<MemoryRouter
			initialEntries={[
				{
					pathname: "/sign-in/create-password",
					search: "?email=user%40example.com&redirect_url=%2Fgenerate",
					state: { rememberMe: false },
				},
			]}
		>
			<Routes>
				<Route path="/sign-in/create-password" element={<CreatePasswordPage />} />
				<Route path="/generate" element={<span>generate page</span>} />
			</Routes>
		</MemoryRouter>,
	);

	fireEvent.change(view.getByLabelText("Password"), { target: { value: "new-password" } });
	fireEvent.change(view.getByLabelText("Confirm password"), { target: { value: "new-password" } });
	fireEvent.click(view.getByRole("button", { name: "Continue" }));

	await waitFor(() => {
		expect(sendSignInOtp).toHaveBeenCalledWith({ email: "user@example.com" });
	});
	fireEvent.change(view.getByLabelText("Verification Code"), { target: { value: "123456" } });
	fireEvent.click(view.getByRole("button", { name: "Create password and sign in" }));

	await waitFor(() => {
		expect(view.getByText("generate page")).toBeInTheDocument();
	});
	expect(signInEmailOtp).toHaveBeenCalledWith({
		email: "user@example.com",
		otp: "123456",
		password: "new-password",
		rememberMe: false,
	});
	expect(refreshSession).toHaveBeenCalledWith({ force: true });
});
