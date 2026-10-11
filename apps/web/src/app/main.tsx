import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isModulePrefetchPending } from "./prefetch";
import { installPreloadErrorRecovery } from "./preload-error-recovery";
import { router } from "./router/router";
import "../../styles.css";
import { AuthProvider } from "@slidesage/ui";

installPreloadErrorRecovery({
	// A hover after a deploy can fetch a chunk that no longer exists. Reloading
	// then would pull the page out from under someone who never clicked, so
	// the reload waits for the navigation that actually needs the chunk.
	ignore: () => isModulePrefetchPending() && router.state.navigation.state === "idle",
});

const container = document.getElementById("root");
if (!container) {
	throw new Error("Missing #root element");
}

createRoot(container).render(
	<StrictMode>
		<AuthProvider>
			<App />
		</AuthProvider>
	</StrictMode>,
);
