import { createInternalAdapter } from "../db/internal-adapter.mjs";
import { getBaseURL } from "../utils/url.mjs";
import { isPromise } from "../utils/is-promise.mjs";
import { env } from "@better-auth/core/env";
import { defu as defu$1 } from "defu";

//#region src/context/helpers.ts
async function runPluginInit(ctx) {
	let options = ctx.options;
	const plugins = options.plugins || [];
	let context = ctx;
	const dbHooks = [];
	for (const plugin of plugins) if (plugin.init) {
		const initPromise = plugin.init(context);
		let result;
		if (isPromise(initPromise)) result = await initPromise;
		else result = initPromise;
		if (typeof result === "object") {
			if (result.options) {
				const { databaseHooks, ...restOpts } = result.options;
				if (databaseHooks) dbHooks.push(databaseHooks);
				options = defu$1(options, restOpts);
			}
			if (result.context) context = {
				...context,
				...result.context
			};
		}
	}
	dbHooks.push(options.databaseHooks);
	context.internalAdapter = createInternalAdapter(context.adapter, {
		options,
		logger: context.logger,
		hooks: dbHooks.filter((u) => u !== void 0),
		generateId: context.generateId
	});
	context.options = options;
	return { context };
}
function getInternalPlugins(options) {
	const plugins = [];
	if (options.advanced?.crossSubDomainCookies?.enabled) {}
	return plugins;
}
async function getTrustedOrigins(options, request) {
	const baseURL = getBaseURL(options.baseURL, options.basePath, request);
	const trustedOrigins = baseURL ? [new URL(baseURL).origin] : [];
	if (options.trustedOrigins) {
		if (Array.isArray(options.trustedOrigins)) trustedOrigins.push(...options.trustedOrigins);
		if (typeof options.trustedOrigins === "function") {
			const validOrigins = await options.trustedOrigins(request);
			trustedOrigins.push(...validOrigins);
		}
	}
	const envTrustedOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS;
	if (envTrustedOrigins) trustedOrigins.push(...envTrustedOrigins.split(","));
	return trustedOrigins.filter((v) => Boolean(v));
}

//#endregion
export { getInternalPlugins, getTrustedOrigins, runPluginInit };
//# sourceMappingURL=helpers.mjs.map