import * as _better_auth_core1 from "@better-auth/core";
import * as better_call8 from "better-call";

//#region src/integrations/tanstack-start.d.ts

/**
 * TanStack Start cookie plugin for React.
 *
 * This plugin automatically handles cookie setting for TanStack Start with React.
 * It uses `@tanstack/react-start-server` to set cookies.
 *
 * For Solid.js, use `better-auth/tanstack-start/solid` instead.
 *
 * @example
 * ```ts
 * import { tanstackStartCookies } from "better-auth/tanstack-start";
 *
 * const auth = betterAuth({
 *   plugins: [tanstackStartCookies()],
 * });
 * ```
 */
declare const tanstackStartCookies: () => {
  id: "tanstack-start-cookies";
  hooks: {
    after: {
      matcher(ctx: _better_auth_core1.HookEndpointContext): true;
      handler: (inputContext: better_call8.MiddlewareInputContext<better_call8.MiddlewareOptions>) => Promise<void>;
    }[];
  };
};
//#endregion
export { tanstackStartCookies };
//# sourceMappingURL=tanstack-start.d.mts.map