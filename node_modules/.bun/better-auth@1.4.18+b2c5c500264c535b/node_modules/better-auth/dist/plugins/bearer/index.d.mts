import * as _better_auth_core3 from "@better-auth/core";
import * as better_call17 from "better-call";

//#region src/plugins/bearer/index.d.ts
interface BearerOptions {
  /**
   * If true, only signed tokens
   * will be converted to session
   * cookies
   *
   * @default false
   */
  requireSignature?: boolean | undefined;
}
/**
 * Converts bearer token to session cookie
 */
declare const bearer: (options?: BearerOptions | undefined) => {
  id: "bearer";
  hooks: {
    before: {
      matcher(context: _better_auth_core3.HookEndpointContext): boolean;
      handler: (inputContext: better_call17.MiddlewareInputContext<better_call17.MiddlewareOptions>) => Promise<{
        context: {
          headers: Headers;
        };
      } | undefined>;
    }[];
    after: {
      matcher(context: _better_auth_core3.HookEndpointContext): true;
      handler: (inputContext: better_call17.MiddlewareInputContext<better_call17.MiddlewareOptions>) => Promise<void>;
    }[];
  };
  options: BearerOptions | undefined;
};
//#endregion
export { BearerOptions, bearer };
//# sourceMappingURL=index.d.mts.map