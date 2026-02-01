import { matchesOriginPattern } from "../../auth/trusted-origins.mjs";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import { deprecate, normalizePathname } from "@better-auth/core/utils";
import { APIError } from "better-call";
import { createAuthMiddleware } from "@better-auth/core/api";

//#region src/api/middlewares/origin-check.ts
/**
* Checks if CSRF should be skipped for backward compatibility.
* Previously, disableOriginCheck also disabled CSRF checks.
* This maintains that behavior when disableCSRFCheck isn't explicitly set.
* Only triggers for skipOriginCheck === true, not for path arrays.
*/
function shouldSkipCSRFForBackwardCompat(ctx) {
	return ctx.context.skipOriginCheck === true && ctx.context.options.advanced?.disableCSRFCheck === void 0;
}
/**
* Logs deprecation warning for users relying on coupled behavior.
* Only logs if user explicitly set disableOriginCheck (not test environment default).
*/
const logBackwardCompatWarning = deprecate(function logBackwardCompatWarning$1() {}, "disableOriginCheck: true currently also disables CSRF checks. In a future version, disableOriginCheck will ONLY disable URL validation. To keep CSRF disabled, add disableCSRFCheck: true to your config.");
/**
* A middleware to validate callbackURL and origin against trustedOrigins.
* Also handles CSRF protection using Fetch Metadata for first-login scenarios.
*/
const originCheckMiddleware = createAuthMiddleware(async (ctx) => {
	if (ctx.request?.method === "GET" || ctx.request?.method === "OPTIONS" || ctx.request?.method === "HEAD" || !ctx.request) return;
	await validateOrigin(ctx);
	if (ctx.context.skipOriginCheck) return;
	const { body, query } = ctx;
	const callbackURL = body?.callbackURL || query?.callbackURL;
	const redirectURL = body?.redirectTo;
	const errorCallbackURL = body?.errorCallbackURL;
	const newUserCallbackURL = body?.newUserCallbackURL;
	const validateURL = (url, label) => {
		if (!url) return;
		if (!ctx.context.isTrustedOrigin(url, { allowRelativePaths: label !== "origin" })) {
			ctx.context.logger.error(`Invalid ${label}: ${url}`);
			ctx.context.logger.info(`If it's a valid URL, please add ${url} to trustedOrigins in your auth config\n`, `Current list of trustedOrigins: ${ctx.context.trustedOrigins}`);
			throw new APIError("FORBIDDEN", { message: `Invalid ${label}` });
		}
	};
	callbackURL && validateURL(callbackURL, "callbackURL");
	redirectURL && validateURL(redirectURL, "redirectURL");
	errorCallbackURL && validateURL(errorCallbackURL, "errorCallbackURL");
	newUserCallbackURL && validateURL(newUserCallbackURL, "newUserCallbackURL");
});
const originCheck = (getValue) => createAuthMiddleware(async (ctx) => {
	if (!ctx.request) return;
	if (ctx.context.skipOriginCheck) return;
	const callbackURL = getValue(ctx);
	const validateURL = (url, label) => {
		if (!url) return;
		if (!ctx.context.isTrustedOrigin(url, { allowRelativePaths: label !== "origin" })) {
			ctx.context.logger.error(`Invalid ${label}: ${url}`);
			ctx.context.logger.info(`If it's a valid URL, please add ${url} to trustedOrigins in your auth config\n`, `Current list of trustedOrigins: ${ctx.context.trustedOrigins}`);
			throw new APIError("FORBIDDEN", { message: `Invalid ${label}` });
		}
	};
	const callbacks = Array.isArray(callbackURL) ? callbackURL : [callbackURL];
	for (const url of callbacks) validateURL(url, "callbackURL");
});
/**
* Validates origin header against trusted origins.
* @param ctx - The endpoint context
* @param forceValidate - If true, always validate origin regardless of cookies/skip flags
*/
async function validateOrigin(ctx, forceValidate = false) {
	const headers = ctx.request?.headers;
	if (!headers || !ctx.request) return;
	const originHeader = headers.get("origin") || headers.get("referer") || "";
	const useCookies = headers.has("cookie");
	if (ctx.context.skipCSRFCheck) return;
	if (shouldSkipCSRFForBackwardCompat(ctx)) {
		ctx.context.options.advanced?.disableOriginCheck === true && logBackwardCompatWarning();
		return;
	}
	const skipOriginCheck = ctx.context.skipOriginCheck;
	if (Array.isArray(skipOriginCheck)) try {
		const basePath = new URL(ctx.context.baseURL).pathname;
		const currentPath = normalizePathname(ctx.request.url, basePath);
		if (skipOriginCheck.some((skipPath) => currentPath.startsWith(skipPath))) return;
	} catch {}
	if (!(forceValidate || useCookies)) return;
	if (!originHeader || originHeader === "null") throw new APIError("FORBIDDEN", { message: BASE_ERROR_CODES.MISSING_OR_NULL_ORIGIN });
	const trustedOrigins = Array.isArray(ctx.context.options.trustedOrigins) ? ctx.context.trustedOrigins : [...ctx.context.trustedOrigins, ...(await ctx.context.options.trustedOrigins?.(ctx.request))?.filter((v) => Boolean(v)) || []];
	if (!trustedOrigins.some((origin) => matchesOriginPattern(originHeader, origin))) {
		ctx.context.logger.error(`Invalid origin: ${originHeader}`);
		ctx.context.logger.info(`If it's a valid URL, please add ${originHeader} to trustedOrigins in your auth config\n`, `Current list of trustedOrigins: ${trustedOrigins}`);
		throw new APIError("FORBIDDEN", { message: "Invalid origin" });
	}
}
/**
* Middleware for CSRF protection using Fetch Metadata headers.
* This prevents cross-site navigation login attacks while supporting progressive enhancement.
*/
const formCsrfMiddleware = createAuthMiddleware(async (ctx) => {
	if (!ctx.request) return;
	await validateFormCsrf(ctx);
});
/**
* Validates CSRF protection for first-login scenarios using Fetch Metadata headers.
* This prevents cross-site form submission attacks while supporting progressive enhancement.
*/
async function validateFormCsrf(ctx) {
	const req = ctx.request;
	if (!req) return;
	if (ctx.context.skipCSRFCheck) return;
	if (shouldSkipCSRFForBackwardCompat(ctx)) return;
	const headers = req.headers;
	if (headers.has("cookie")) return await validateOrigin(ctx);
	const site = headers.get("Sec-Fetch-Site");
	const mode = headers.get("Sec-Fetch-Mode");
	const dest = headers.get("Sec-Fetch-Dest");
	if (Boolean(site && site.trim() || mode && mode.trim() || dest && dest.trim())) {
		if (site === "cross-site" && mode === "navigate") {
			ctx.context.logger.error("Blocked cross-site navigation login attempt (CSRF protection)", {
				secFetchSite: site,
				secFetchMode: mode,
				secFetchDest: dest
			});
			throw new APIError("FORBIDDEN", { message: BASE_ERROR_CODES.CROSS_SITE_NAVIGATION_LOGIN_BLOCKED });
		}
		return await validateOrigin(ctx, true);
	}
}

//#endregion
export { formCsrfMiddleware, originCheck, originCheckMiddleware };
//# sourceMappingURL=origin-check.mjs.map