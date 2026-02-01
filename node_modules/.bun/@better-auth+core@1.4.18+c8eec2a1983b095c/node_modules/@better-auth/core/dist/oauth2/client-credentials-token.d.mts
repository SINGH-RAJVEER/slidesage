import { OAuth2Tokens, ProviderOptions } from "./oauth-provider.mjs";

//#region src/oauth2/client-credentials-token.d.ts
declare function createClientCredentialsTokenRequest({
  options,
  scope,
  authentication,
  resource
}: {
  options: ProviderOptions & {
    clientSecret: string;
  };
  scope?: string | undefined;
  authentication?: ("basic" | "post") | undefined;
  resource?: (string | string[]) | undefined;
}): {
  body: URLSearchParams;
  headers: Record<string, any>;
};
declare function clientCredentialsToken({
  options,
  tokenEndpoint,
  scope,
  authentication,
  resource
}: {
  options: ProviderOptions & {
    clientSecret: string;
  };
  tokenEndpoint: string;
  scope: string;
  authentication?: ("basic" | "post") | undefined;
  resource?: (string | string[]) | undefined;
}): Promise<OAuth2Tokens>;
//#endregion
export { clientCredentialsToken, createClientCredentialsTokenRequest };
//# sourceMappingURL=client-credentials-token.d.mts.map