import { BASE_ERROR_CODES } from "./codes.mjs";

//#region src/error/index.ts
var BetterAuthError = class extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "BetterAuthError";
		this.message = message;
		this.stack = "";
	}
};

//#endregion
export { BASE_ERROR_CODES, BetterAuthError };
//# sourceMappingURL=index.mjs.map