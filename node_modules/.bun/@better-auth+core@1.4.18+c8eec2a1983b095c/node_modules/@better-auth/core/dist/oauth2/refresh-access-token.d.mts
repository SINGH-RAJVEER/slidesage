import { OAuth2Tokens, ProviderOptions } from "./oauth-provider.mjs";

//#region src/oauth2/refresh-access-token.d.ts
declare function createRefreshAccessTokenRequest({
  refreshToken,
  options,
  authentication,
  extraParams,
  resource
}: {
  refreshToken: string;
  options: Partial<ProviderOptions>;
  authentication?: ("basic" | "post") | undefined;
  extraParams?: Record<string, string> | undefined;
  resource?: (string | string[]) | undefined;
}): {
  body: URLSearchParams;
  headers: Record<string, any>;
};
declare function refreshAccessToken({
  refreshToken,
  options,
  tokenEndpoint,
  authentication,
  extraParams
}: {
  refreshToken: string;
  options: Partial<ProviderOptions>;
  tokenEndpoint: string;
  authentication?: ("basic" | "post") | undefined;
  extraParams?: Record<string, string> | undefined;
  /** @deprecated always "refresh_token" */
  grantType?: string | undefined;
}): Promise<OAuth2Tokens>;
//#endregion
export { createRefreshAccessTokenRequest, refreshAccessToken };
//# sourceMappingURL=refresh-access-token.d.mts.map