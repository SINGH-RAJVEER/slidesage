import { useAuth } from "@slidesage/ui";
import { Button } from "@slidesage/ui/components/button";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { auth } from "@slidesage/ui/lib/auth-client";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";

function sanitizeRedirectPath(value: string | null) {
	if (!value) return "/";
	if (!value.startsWith("/")) return "/";
	if (value.startsWith("//")) return "/";
	return value;
}

const inputClassName =
	"w-full rounded-lg bg-white/10 border border-white/15 px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20";
const primaryButtonClassName =
	"h-auto w-full rounded-lg bg-white px-4 py-3 text-base font-semibold text-black shadow-sm hover:bg-white/90 disabled:opacity-60";
const quietButtonClassName =
	"h-auto w-full bg-transparent px-4 py-2 text-sm font-medium text-white/60 shadow-none hover:bg-transparent hover:text-white disabled:opacity-60";

// CreatePasswordPage lets an account without a password create one from the
// sign-in flow. The password is saved only once an emailed code confirms it,
// and the same step signs the user in.
export default function CreatePasswordPage() {
	const [searchParams] = useSearchParams();
	const email = searchParams.get("email");
	const redirectTo = sanitizeRedirectPath(searchParams.get("redirect_url"));
	const navigate = useNavigate();
	const location = useLocation();
	const rememberMe = (location.state as { rememberMe?: boolean } | null)?.rememberMe ?? true;
	const { isSignedIn, refreshSession } = useAuth();
	const [step, setStep] = useState<"password" | "code">("password");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [code, setCode] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!email) navigate(ROUTES.signIn, { replace: true });
	}, [email, navigate]);

	useEffect(() => {
		if (isSignedIn) navigate(redirectTo, { replace: true });
	}, [isSignedIn, navigate, redirectTo]);

	useEffect(() => {
		if (resendCooldownSeconds <= 0) return;

		const timer = window.setInterval(() => {
			setResendCooldownSeconds((seconds) => Math.max(0, seconds - 1));
		}, 1000);

		return () => window.clearInterval(timer);
	}, [resendCooldownSeconds]);

	const sendCode = async () => {
		if (!email) return false;
		try {
			await auth.sendSignInOtp({ email });
			setResendCooldownSeconds(30);
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to send verification code.");
			return false;
		}
	};

	const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);

		if (password !== confirmPassword) {
			setError("Passwords do not match.");
			return;
		}

		setSubmitting(true);
		if (await sendCode()) {
			setStep("code");
		}
		setSubmitting(false);
	};

	const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);

		if (!email) return;

		if (code.length !== 6) {
			setError("Please enter a valid 6-digit code.");
			return;
		}

		setSubmitting(true);

		try {
			await auth.signInEmailOtp({ email, otp: code, password, rememberMe });
			await refreshSession({ force: true });
			navigate(redirectTo, { replace: true });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Verification failed.");
		} finally {
			setSubmitting(false);
		}
	};

	const handleResend = async () => {
		setError(null);
		setSubmitting(true);
		await sendCode();
		setSubmitting(false);
	};

	return (
		<div className="min-h-screen bg-transparent flex flex-col">
			<Header />
			<FloatingNotice error={error} onDismiss={() => setError(null)} />
			<div className="flex flex-1 items-center justify-center px-4 py-8 desktop:px-8">
				<div className="max-w-md w-full">
					<h1 className="mb-1 text-2xl font-semibold text-white">Create a password</h1>
					<p className="mb-6 text-white/65">
						{step === "password" ? (
							<>
								<span className="font-semibold text-white">{email}</span> has no password yet.
								Choose one, then confirm it with a code we email you.
							</>
						) : (
							<>
								We sent a 6-digit code to <span className="font-semibold text-white">{email}</span>.
							</>
						)}
					</p>

					{step === "password" ? (
						<form className="space-y-4" onSubmit={handlePasswordSubmit}>
							<div className="space-y-2">
								<label htmlFor="new-password" className="text-sm font-medium text-white/80">
									Password
								</label>
								<input
									id="new-password"
									type="password"
									autoComplete="new-password"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									className={inputClassName}
									placeholder="At least 8 characters"
									minLength={8}
									required
								/>
							</div>

							<div className="space-y-2">
								<label htmlFor="confirm-password" className="text-sm font-medium text-white/80">
									Confirm password
								</label>
								<input
									id="confirm-password"
									type="password"
									autoComplete="new-password"
									value={confirmPassword}
									onChange={(event) => setConfirmPassword(event.target.value)}
									className={inputClassName}
									placeholder="Re-enter your password"
									minLength={8}
									required
								/>
							</div>

							<Button type="submit" className={primaryButtonClassName} disabled={submitting}>
								{submitting ? "Sending code..." : "Continue"}
							</Button>
						</form>
					) : (
						<form className="space-y-4" onSubmit={handleCodeSubmit}>
							<div className="space-y-2">
								<label htmlFor="code" className="text-sm font-medium text-white/80">
									Verification Code
								</label>
								<input
									id="code"
									type="text"
									inputMode="numeric"
									autoComplete="one-time-code"
									maxLength={6}
									value={code}
									onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
									placeholder="000000"
									className={`${inputClassName} text-center text-2xl tracking-widest font-mono`}
									required
								/>
								<p className="mt-2 text-center text-xs text-white/50">Code expires in 15 minutes</p>
							</div>

							<Button
								type="submit"
								className={primaryButtonClassName}
								disabled={submitting || code.length !== 6}
							>
								{submitting ? "Verifying..." : "Create password and sign in"}
							</Button>

							<Button
								type="button"
								onClick={handleResend}
								className={quietButtonClassName}
								disabled={submitting || resendCooldownSeconds > 0}
							>
								{resendCooldownSeconds > 0
									? `Resend Code in ${resendCooldownSeconds}s`
									: "Resend Code"}
							</Button>

							<Button
								type="button"
								onClick={() => {
									setStep("password");
									setCode("");
									setError(null);
								}}
								className={quietButtonClassName}
							>
								Change password
							</Button>
						</form>
					)}

					<p className="mt-6 text-center text-sm text-white/55">
						<Link
							to={`${ROUTES.signIn}?redirect_url=${encodeURIComponent(redirectTo)}`}
							className="font-semibold text-white hover:underline"
						>
							Back to sign in
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}
