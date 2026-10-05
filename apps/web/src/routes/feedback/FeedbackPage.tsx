import { type ApiErrorResponse, FEEDBACK_MAX_LENGTH, type FeedbackRequest } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { Textarea } from "@slidesage/ui/components/textarea";
import { API_URL, readJsonResponse } from "@slidesage/ui/lib/api";
import { type FormEvent, useCallback, useState } from "react";
import Header from "../../app/Header";
import { usePageDraft } from "../../hooks/usePageDraft";

export default function FeedbackPage() {
	const [message, setMessage] = usePageDraft(
		"feedback",
		"",
		(value): value is string => typeof value === "string" && value.length <= FEEDBACK_MAX_LENGTH,
	);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const dismissNotice = useCallback(() => {
		setError(null);
		setSuccess(null);
	}, []);

	const trimmed = message.trim();

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (!trimmed || sending) return;
		setSending(true);
		setError(null);
		setSuccess(null);
		try {
			const res = await fetch(`${API_URL}/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ message: trimmed } satisfies FeedbackRequest),
			});
			if (!res.ok) {
				const data = await readJsonResponse<ApiErrorResponse>(res);
				throw new Error(data?.error?.message || "Failed to send feedback");
			}
			setMessage("");
			setSuccess("Thanks, your feedback was sent");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to send feedback");
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="flex min-h-screen flex-col bg-transparent">
			<Header />
			<FloatingNotice error={error} success={success} onDismiss={dismissNotice} />
			<main className="flex-1 px-4 py-8 md:px-8 md:py-12">
				<form className="mx-auto w-full max-w-2xl" onSubmit={handleSubmit}>
					<div className="text-center">
						<h1 className="text-3xl font-semibold text-white md:text-4xl">Feedback</h1>
					</div>
					<label htmlFor="feedback-message" className="sr-only">
						Your feedback
					</label>
					<Textarea
						id="feedback-message"
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						maxLength={FEEDBACK_MAX_LENGTH}
						placeholder="Tell us what you think..."
						className="mt-8 min-h-48 rounded-lg border-white/15 bg-white/10 px-4 py-3 text-base text-white placeholder:text-white/40 focus-visible:border-white/30 focus-visible:ring-white/20 md:text-base"
					/>
					<div className="mt-3 flex items-center justify-between gap-4">
						<span className="text-xs text-white/50">
							{`${message.length} / ${FEEDBACK_MAX_LENGTH}`}
						</span>
						<Button
							type="submit"
							disabled={!trimmed || sending}
							className="h-11 bg-white px-5 text-[#151c2a] hover:bg-white/90"
						>
							{sending ? "Sending..." : "Send feedback"}
						</Button>
					</div>
				</form>
			</main>
		</div>
	);
}
