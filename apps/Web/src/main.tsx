import { ClerkProvider } from "@clerk/clerk-react";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import "./globals.css";
import { clerkAppearance } from "@/lib/clerk-appearance";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const container = document.getElementById("root");
if (!container) {
	throw new Error("Missing #root element");
}

const rootContainer: HTMLElement = container;

function renderFatal(message: string) {
	createRoot(rootContainer).render(
		<StrictMode>
			<div className="min-h-screen bg-transparent flex items-center justify-center px-6">
				<div className="max-w-xl w-full border border-white/10 bg-white/5 backdrop-blur-md rounded-2xl p-8 shadow-2xl">
					<div className="text-white text-xl font-semibold">
						App failed to start
					</div>
					<div className="text-white/70 mt-3 break-words">{message}</div>
					<div className="text-white/50 mt-4 text-sm">
						Check your Vite env vars (e.g.{" "}
						<span className="font-mono">VITE_CLERK_PUBLISHABLE_KEY</span>).
					</div>
				</div>
			</div>
		</StrictMode>,
	);
}

if (!PUBLISHABLE_KEY) {
	renderFatal("Missing VITE_CLERK_PUBLISHABLE_KEY");
	// Don’t proceed to initialize Clerk.
	throw new Error("Missing Clerk Publishable Key");
}

const app = (
	<StrictMode>
		<ClerkProvider
			publishableKey={PUBLISHABLE_KEY}
			signInUrl="/sign-in"
			signUpUrl="/sign-up"
			afterSignOutUrl="/sign-in"
			appearance={clerkAppearance}
		>
			<App />
		</ClerkProvider>
	</StrictMode>
);

if (import.meta.hot) {
	const data = import.meta.hot.data as { root?: Root };

	if (!data.root) {
		data.root = createRoot(rootContainer);
	}

	data.root.render(app);
} else {
	createRoot(rootContainer).render(app);
}
