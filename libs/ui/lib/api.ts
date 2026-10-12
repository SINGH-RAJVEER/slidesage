export async function readJsonResponse<T>(response: Response): Promise<T | null> {
	try {
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

export function normalizeApiUrl(value: string | undefined): string {
	const trimmedValue = value?.trim().replace(/\/+$/, "") ?? "";
	if (!trimmedValue || trimmedValue.startsWith("/")) return trimmedValue;
	if (/^https?:\/\//i.test(trimmedValue)) return trimmedValue;

	const hostname = trimmedValue.split("/")[0]?.split(":")[0]?.toLowerCase();
	const protocol = hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https";

	return `${protocol}://${trimmedValue}`;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

export function resolveApiUrl(
	value: string | undefined,
	isProduction: boolean,
	frontendOrigin?: string,
): string {
	const normalizedUrl = normalizeApiUrl(value);
	if (!normalizedUrl || normalizedUrl.startsWith("/")) {
		if (!isProduction && !normalizedUrl && frontendOrigin) {
			try {
				const frontendUrl = new URL(frontendOrigin);
				if (LOOPBACK_HOSTNAMES.has(frontendUrl.hostname.toLowerCase())) {
					return `${frontendUrl.protocol}//${frontendUrl.hostname}:8000`;
				}
			} catch {}
		}
		return normalizedUrl;
	}

	try {
		if (!isProduction) return normalizedUrl;

		const hostname = new URL(normalizedUrl).hostname.toLowerCase();
		return LOOPBACK_HOSTNAMES.has(hostname) ? "" : normalizedUrl;
	} catch {
		return normalizedUrl;
	}
}

const getApiUrlEnv = (): string | undefined => {
	try {
		if (typeof import.meta !== "undefined" && import.meta?.env) {
			return import.meta.env["VITE_API_URL"];
		}
	} catch {}
	try {
		if (typeof process !== "undefined" && process?.env) {
			// @ts-expect-error Bun requires literal property access for browser environment inlining.
			return process.env.VITE_API_URL;
		}
	} catch {}
	try {
		if (typeof window !== "undefined") {
			const runtimeWindow = window as Window & {
				__ENV__?: { VITE_API_URL?: string };
			};
			return runtimeWindow.__ENV__?.VITE_API_URL;
		}
	} catch {}
	return undefined;
};

const isProd = (): boolean => {
	try {
		if (typeof import.meta !== "undefined" && import.meta?.env) {
			return Boolean(import.meta.env["PROD"]);
		}
	} catch {}
	try {
		if (typeof process !== "undefined" && process?.env) {
			return process.env["NODE_ENV"] === "production";
		}
	} catch {}
	return false;
};

export const API_URL = resolveApiUrl(
	getApiUrlEnv(),
	isProd(),
	typeof window === "undefined" ? undefined : window.location.origin,
);

/** A GET's outcome: the body when it succeeded, otherwise the status and the API's reason. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message?: string };

/** Reads a signed-in JSON resource without throwing for an HTTP error. */
export async function getJson<T>(path: string): Promise<ApiResult<T>> {
	const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
	const body = await readJsonResponse<T | { error?: { message?: string } }>(response);
	if (response.ok && body !== null && !(typeof body === "object" && "error" in body)) {
		return { ok: true, data: body as T };
	}
	const message =
		body !== null && typeof body === "object" && "error" in body ? body.error?.message : undefined;
	return { ok: false, status: response.status, message };
}
