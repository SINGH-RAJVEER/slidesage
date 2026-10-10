/// <reference lib="dom" />

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

const sendVerificationOtp = mock(async () => ({ success: true }));
const verifyEmail = mock(async () => ({ status: true, token: "jwt", user: { id: "user_1" } }));
const sendSignInOtp = mock(async () => ({ success: true }));
const signInEmailOtp = mock(async () => ({ token: "jwt", user: { id: "user_1" } }));
const refreshSession = mock(async () => {});

mock.module("@slidesage/ui/lib/auth-client", () => {
	return {
		auth: {
			sendVerificationOtp,
			verifyEmail,
			sendSignInOtp,
			signInEmailOtp,
		},
	};
});

mock.module("@slidesage/ui/context/AuthContext", () => {
	return {
		useAuth: () => ({
			isSignedIn: false,
			user: null,
			refreshSession,
		}),
		AuthProvider: ({ children }: { children: ReactNode }) => children,
	};
});

describe("VerifyEmailPage", () => {
	it("completes an email change through the profile verification endpoint", async () => {
		const originalFetch = globalThis.fetch;
		const fetchMock = mock(async () => Response.json({ user: { id: "user_1" } }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		refreshSession.mockClear();
		verifyEmail.mockClear();

		try {
			const { default: VerifyEmailPage } = await import("../../../routes/auth/VerifyEmailPage");
			const view = render(
				<MemoryRouter
					initialEntries={[
						"/sign-up/verify-email?email=new%40example.com&redirect_url=%2Fprofile&mode=email-change",
					]}
				>
					<VerifyEmailPage />
				</MemoryRouter>,
			);

			fireEvent.change(view.getByLabelText("Verification Code"), {
				target: { value: "123456" },
			});
			fireEvent.click(view.getByRole("button", { name: "Verify Email" }));

			await waitFor(() => {
				expect(fetchMock).toHaveBeenCalledWith(
					expect.stringContaining("/profile/email/verify"),
					expect.objectContaining({
						method: "POST",
						body: JSON.stringify({
							email: "new@example.com",
							otp: "123456",
						}),
					}),
				);
			});
			expect(refreshSession).toHaveBeenCalledWith({ force: true });
			expect(verifyEmail).not.toHaveBeenCalled();
			expect(view.queryByRole("button", { name: "Resend Code" })).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("signs in with an emailed code in sign-in mode", async () => {
		refreshSession.mockClear();
		verifyEmail.mockClear();
		const { default: VerifyEmailPage } = await import("../../../routes/auth/VerifyEmailPage");
		const view = render(
			<MemoryRouter
				initialEntries={[
					{
						pathname: "/sign-in/verify",
						search: "?mode=sign-in&email=user%40example.com&redirect_url=%2Fgenerate",
						state: { rememberMe: false },
					},
				]}
			>
				<VerifyEmailPage />
			</MemoryRouter>,
		);

		fireEvent.click(view.getByRole("button", { name: "Resend Code" }));
		await waitFor(() => {
			expect(sendSignInOtp).toHaveBeenCalledWith({ email: "user@example.com" });
		});

		fireEvent.change(view.getByLabelText("Verification Code"), {
			target: { value: "123456" },
		});
		fireEvent.click(view.getByRole("button", { name: "Sign In" }));

		await waitFor(() => {
			expect(signInEmailOtp).toHaveBeenCalledWith({
				email: "user@example.com",
				otp: "123456",
				rememberMe: false,
			});
		});
		expect(refreshSession).toHaveBeenCalledWith({ force: true });
		expect(verifyEmail).not.toHaveBeenCalled();
		expect(sendVerificationOtp).not.toHaveBeenCalled();
	});

	it("starts a resend cooldown instead of showing a browser alert or success message", async () => {
		const alertMock = mock(() => {});
		const originalAlert = globalThis.alert;
		globalThis.alert = alertMock as typeof alert;

		try {
			const { default: VerifyEmailPage } = await import("../../../routes/auth/VerifyEmailPage");

			const view = render(
				<MemoryRouter initialEntries={["/sign-up/verify-email?email=rajveer%40example.com"]}>
					<VerifyEmailPage />
				</MemoryRouter>,
			);

			fireEvent.click(view.getByRole("button", { name: "Resend Code" }));

			await waitFor(() => {
				expect(sendVerificationOtp).toHaveBeenCalledTimes(1);
			});

			expect(alertMock).not.toHaveBeenCalled();
			expect(view.queryByText("A new verification code was sent to your email.")).toBeNull();
			expect(view.getByRole("button", { name: "Resend Code in 30s" })).toBeDisabled();
		} finally {
			globalThis.alert = originalAlert;
		}
	});
});
