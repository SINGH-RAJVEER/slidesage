import { DBAdapter, DBTransactionAdapter } from "../db/adapter/index.mjs";
import { AsyncLocalStorage } from "node:async_hooks";

//#region src/context/transaction.d.ts

/**
 * This is for internal use only. Most users should use `getCurrentAdapter` instead.
 *
 * It is exposed for advanced use cases where you need direct access to the AsyncLocalStorage instance.
 */
declare const getCurrentDBAdapterAsyncLocalStorage: () => Promise<AsyncLocalStorage<DBTransactionAdapter>>;
declare const getCurrentAdapter: (fallback: DBTransactionAdapter) => Promise<DBTransactionAdapter>;
declare const runWithAdapter: <R>(adapter: DBAdapter, fn: () => R) => Promise<R>;
declare const runWithTransaction: <R>(adapter: DBAdapter, fn: () => R) => Promise<R>;
//#endregion
export { getCurrentAdapter, getCurrentDBAdapterAsyncLocalStorage, runWithAdapter, runWithTransaction };
//# sourceMappingURL=transaction.d.mts.map