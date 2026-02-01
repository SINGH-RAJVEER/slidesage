import { __getBetterAuthGlobal } from "./global.mjs";
import { getAsyncLocalStorage } from "@better-auth/core/async_hooks";

//#region src/context/transaction.ts
const ensureAsyncStorage = async () => {
	const betterAuthGlobal = __getBetterAuthGlobal();
	if (!betterAuthGlobal.context.adapterAsyncStorage) {
		const AsyncLocalStorage$1 = await getAsyncLocalStorage();
		betterAuthGlobal.context.adapterAsyncStorage = new AsyncLocalStorage$1();
	}
	return betterAuthGlobal.context.adapterAsyncStorage;
};
/**
* This is for internal use only. Most users should use `getCurrentAdapter` instead.
*
* It is exposed for advanced use cases where you need direct access to the AsyncLocalStorage instance.
*/
const getCurrentDBAdapterAsyncLocalStorage = async () => {
	return ensureAsyncStorage();
};
const getCurrentAdapter = async (fallback) => {
	return ensureAsyncStorage().then((als) => {
		return als.getStore() || fallback;
	}).catch(() => {
		return fallback;
	});
};
const runWithAdapter = async (adapter, fn) => {
	let called = true;
	return ensureAsyncStorage().then((als) => {
		called = true;
		return als.run(adapter, fn);
	}).catch((err) => {
		if (!called) return fn();
		throw err;
	});
};
const runWithTransaction = async (adapter, fn) => {
	let called = true;
	return ensureAsyncStorage().then((als) => {
		called = true;
		return adapter.transaction(async (trx) => {
			return als.run(trx, fn);
		});
	}).catch((err) => {
		if (!called) return fn();
		throw err;
	});
};

//#endregion
export { getCurrentAdapter, getCurrentDBAdapterAsyncLocalStorage, runWithAdapter, runWithTransaction };
//# sourceMappingURL=transaction.mjs.map