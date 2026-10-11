/// <reference lib="dom" />

import { describe, expect, it, mock } from "bun:test";
import { installPreloadErrorRecovery } from "../../app/preload-error-recovery";

function createStorage() {
	const values = new Map<string, string>();

	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

function createPreloadError(url: string) {
	return Object.assign(new Event("vite:preloadError", { cancelable: true }), {
		payload: new TypeError(`error loading dynamically imported module: ${url}`),
	});
}

describe("preload error recovery", () => {
	it("reloads once when a deployment removed a dynamic import", () => {
		const storage = createStorage();
		const reload = mock(() => {});
		const uninstall = installPreloadErrorRecovery({ storage, reload });
		const chunkUrl = "https://slidesage.app/assets/PresentationsGridPage-DlXHrgqO.js";

		const firstErrorWasHandled = !window.dispatchEvent(createPreloadError(chunkUrl));
		const repeatedErrorWasHandled = !window.dispatchEvent(createPreloadError(chunkUrl));

		expect(firstErrorWasHandled).toBe(true);
		expect(repeatedErrorWasHandled).toBe(false);
		expect(reload).toHaveBeenCalledTimes(1);
		uninstall();
	});

	it("allows one recovery for each distinct failed chunk", () => {
		const storage = createStorage();
		const reload = mock(() => {});
		const uninstall = installPreloadErrorRecovery({ storage, reload });

		window.dispatchEvent(
			createPreloadError("https://slidesage.app/assets/PresentationsGridPage-old.js"),
		);
		window.dispatchEvent(
			createPreloadError("https://slidesage.app/assets/PresentationViewer-old.js"),
		);

		expect(reload).toHaveBeenCalledTimes(2);
		uninstall();
	});

	it("does not risk a reload loop when session storage is unavailable", () => {
		const reload = mock(() => {});
		const uninstall = installPreloadErrorRecovery({
			storage: {
				getItem: () => {
					throw new Error("storage unavailable");
				},
				setItem: () => {
					throw new Error("storage unavailable");
				},
			},
			reload,
		});

		const errorWasHandled = !window.dispatchEvent(
			createPreloadError("https://slidesage.app/assets/PresentationsGridPage-old.js"),
		);

		expect(errorWasHandled).toBe(false);
		expect(reload).not.toHaveBeenCalled();
		uninstall();
	});

	it("leaves an ignored failure for the navigation that needs the chunk", () => {
		const storage = createStorage();
		const reload = mock(() => {});
		let prefetching = true;
		const uninstall = installPreloadErrorRecovery({
			storage,
			reload,
			ignore: () => prefetching,
		});
		const chunkUrl = "https://slidesage.app/assets/PresentationPage-old.js";

		const prefetchErrorWasHandled = !window.dispatchEvent(createPreloadError(chunkUrl));
		prefetching = false;
		const navigationErrorWasHandled = !window.dispatchEvent(createPreloadError(chunkUrl));

		expect(prefetchErrorWasHandled).toBe(false);
		expect(navigationErrorWasHandled).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
		uninstall();
	});
});
