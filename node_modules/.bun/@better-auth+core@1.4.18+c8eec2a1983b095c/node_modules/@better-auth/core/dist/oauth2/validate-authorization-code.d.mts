import { OAuth2Tokens, ProviderOptions } from "./oauth-provider.mjs";
import "./index.mjs";
import * as jose0 from "jose";

//#region src/oauth2/validate-authorization-code.d.ts
declare function createAuthorizationCodeRequest({
  code,
  codeVerifier,
  redirectURI,
  options,
  authentication,
  deviceId,
  headers,
  additionalParams,
  resource
}: {
  code: string;
  redirectURI: string;
  options: Partial<ProviderOptions>;
  codeVerifier?: string | undefined;
  deviceId?: string | undefined;
  authentication?: ("basic" | "post") | undefined;
  headers?: Record<string, string> | undefined;
  additionalParams?: Record<string, string> | undefined;
  resource?: (string | string[]) | undefined;
}): {
  body: URLSearchParams;
  headers: Record<string, any>;
};
declare function validateAuthorizationCode({
  code,
  codeVerifier,
  redirectURI,
  options,
  tokenEndpoint,
  authentication,
  deviceId,
  headers,
  additionalParams,
  resource
}: {
  code: string;
  redirectURI: string;
  options: Partial<ProviderOptions>;
  codeVerifier?: string | undefined;
  deviceId?: string | undefined;
  tokenEndpoint: string;
  authentication?: ("basic" | "post") | undefined;
  headers?: Record<string, string> | undefined;
  additionalParams?: Record<string, string> | undefined;
  resource?: (string | string[]) | undefined;
}): Promise<OAuth2Tokens>;
declare function validateToken(token: string, jwksEndpoint: string): Promise<jose0.JWTVerifyResult<jose0.JWTPayload>>;
//#endregion
export { createAuthorizationCodeRequest, validateAuthorizationCode, validateToken };
//# sourceMappingURL=validate-authorization-code.d.mts.map