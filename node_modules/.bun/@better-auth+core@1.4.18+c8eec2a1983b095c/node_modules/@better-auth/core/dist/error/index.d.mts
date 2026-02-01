import { BASE_ERROR_CODES } from "./codes.mjs";

//#region src/error/index.d.ts
declare class BetterAuthError extends Error {
  constructor(message: string, options?: {
    cause?: unknown | undefined;
  });
}
//#endregion
export { BASE_ERROR_CODES, BetterAuthError };
//# sourceMappingURL=index.d.mts.map