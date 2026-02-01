import { BaseCaptchaOptions, CaptchaFoxOptions, CaptchaOptions, CloudflareTurnstileOptions, GoogleRecaptchaOptions, HCaptchaOptions, Provider } from "./types.mjs";
import * as _better_auth_core5 from "@better-auth/core";

//#region src/plugins/captcha/index.d.ts
declare const captcha: (options: CaptchaOptions) => {
  id: "captcha";
  onRequest: (request: Request, ctx: _better_auth_core5.AuthContext) => Promise<{
    response: Response;
  } | undefined>;
  options: CaptchaOptions;
};
//#endregion
export { BaseCaptchaOptions, CaptchaFoxOptions, CaptchaOptions, CloudflareTurnstileOptions, GoogleRecaptchaOptions, HCaptchaOptions, Provider, captcha };
//# sourceMappingURL=index.d.mts.map