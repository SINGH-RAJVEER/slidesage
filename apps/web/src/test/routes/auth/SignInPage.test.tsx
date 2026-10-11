/// <reference lib="dom" />

import { expect, it, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

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

const signIn = mock(async () => {
	throw new MockAuthError("email address is not verified", 401, "EMAIL_NOT_VERIFIED");
});
const sendVerificationOtp = mock(async () => ({ success: true }));
const sendSignInOtp = mock(async () => ({ success: true }));

mock.module("@slidesage/ui/context/AuthContext", () => ({
	useAuth: () => ({
		isSignedIn: false,
		refreshSession: mock(),
		user: null,
	}),
}));

mock.module("@slidesage/ui/lib/auth-client", () => ({
	auth: {
		signInEmail: signIn,
		startSocialSignIn: mock(),
		sendVerificationOtp,
		sendSignInOtp,
	},
}));

function VerificationProbe() {
	const location = useLocation();
	const params = new URLSearchParams(location.search);
	return <span>{params.get("email")}</span>;
}

it("resends verification when an unverified user signs in", async () => {
	signIn.mockClear();
	sendVerificationOtp.mockClear();
	const { default: SignInPage } = await import("../../../routes/auth/SignInPage");
	const view = render(
		<MemoryRouter initialEntries={["/sign-in"]}>
			<Routes>
				<Route path="/sign-in" element={<SignInPage />} />
				<Route path="/sign-up/verify-email" element={<VerificationProbe />} />
			</Routes>
		</MemoryRouter>,
	);

	fireEvent.change(view.getByLabelText("Email"), { target: { value: "User@Example.com" } });
	fireEvent.click(view.getByRole("button", { name: "Sign in with a password instead" }));
	fireEvent.change(view.getByLabelText("Password"), { target: { value: "correct-password" } });
	fireEvent.click(view.getByRole("button", { name: "Sign In" }));

	await waitFor(() => {
		expect(view.getByText("user@example.com")).toBeInTheDocument();
	});
	expect(sendVerificationOtp).toHaveBeenCalledWith({
		email: "user@example.com",
		type: "email-verification",
	});
});

it("emails a sign-in code by default and opens code entry", async () => {
	sendSignInOtp.mockClear();
	const { default: SignInPage } = await import("../../../routes/auth/SignInPage");
	const view = render(
		<MemoryRouter initialEntries={["/sign-in"]}>
			<Routes>
				<Route path="/sign-in" element={<SignInPage />} />
				<Route path="/sign-in/verify" element={<VerificationProbe />} />
			</Routes>
		</MemoryRouter>,
	);

	expect(view.queryByLabelText("Password")).toBeNull();
	fireEvent.change(view.getByLabelText("Email"), { target: { value: "User@Example.com" } });
	fireEvent.click(view.getByRole("button", { name: "Email me a sign-in code" }));

	await waitFor(() => {
		expect(view.getByText("user@example.com")).toBeInTheDocument();
	});
	expect(sendSignInOtp).toHaveBeenCalledWith({ email: "user@example.com" });
});

it("shows the orb loader when switching to sign up", async () => {
	const { default: SignInPage } = await import("../../../routes/auth/SignInPage");
	const view = render(
		<MemoryRouter initialEntries={["/sign-in"]}>
			<SignInPage />
		</MemoryRouter>,
	);

	const switchLink = view.getByRole("link", { name: "Sign up" });
	expect(switchLink.getAttribute("href")).toBe("/sign-up");

	fireEvent.click(switchLink);

	expect(view.getByLabelText("Loading sign up")).toBeInTheDocument();
});

it("preserves redirect_url when switching to sign up", async () => {
	const { default: SignInPage } = await import("../../../routes/auth/SignInPage");
	const view = render(
		<MemoryRouter initialEntries={["/sign-in?redirect_url=%2Fgenerate"]}>
			<Routes>
				<Route path="/sign-in" element={<SignInPage />} />
			</Routes>
		</MemoryRouter>,
	);

	expect(view.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe(
		"/sign-up?redirect_url=%2Fgenerate",
	);
});
