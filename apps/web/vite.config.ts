import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Google's certification authority ID for AdSense sellers. */
const GOOGLE_SELLER_AUTHORITY = "f08c47fec0942fa0";

/** Publishes ads.txt for the AdSense publisher, when the build has one. */
function adsTxt(clientId: string | undefined): Plugin {
	return {
		name: "slidesage-ads-txt",
		apply: "build",
		generateBundle() {
			const publisher = clientId?.trim().match(/^ca-(pub-\d{10,20})$/)?.[1];
			if (!publisher) return;
			this.emitFile({
				type: "asset",
				fileName: "ads.txt",
				source: `google.com, ${publisher}, DIRECT, ${GOOGLE_SELLER_AUTHORITY}\n`,
			});
		},
	};
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "VITE_ADSENSE_");

	return {
		plugins: [react(), tailwindcss(), adsTxt(env["VITE_ADSENSE_CLIENT_ID"])],
		server: {
			host: "0.0.0.0",
			port: 5173,
			strictPort: true,
		},
		preview: {
			host: "0.0.0.0",
			port: 4173,
			strictPort: true,
		},
	};
});
