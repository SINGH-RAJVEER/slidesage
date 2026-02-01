import { getOAuth2Tokens } from "./utils.mjs";
import "./index.mjs";
import { base64 } from "@better-auth/utils/base64";
import { betterFetch } from "@better-fetch/fetch";
import { jwtVerify } from "jose";

//#region src/oauth2/validate-authorization-code.ts
function createAuthorizationCodeRequest({ code, codeVerifier, redirectURI, options, authentication, deviceId, headers, additionalParams = {}, resource }) {
	const body = new URLSearchParams();
	const requestHeaders = {
		"content-type": "application/x-www-form-urlencoded",
		accept: "application/json",
		...headers
	};
	body.set("grant_type", "authorization_code");
	body.set("code", code);
	codeVerifier && body.set("code_verifier", codeVerifier);
	options.clientKey && body.set("client_key", options.clientKey);
	deviceId && body.set("device_id", deviceId);
	body.set("redirect_uri", options.redirectURI || redirectURI);
	if (resource) if (typeof resource === "string") body.append("resource", resource);
	else for (const _resource of resource) body.append("resource", _resource);
	if (authentication === "basic") {
		const primaryClientId = Array.isArray(options.clientId) ? options.clientId[0] : options.clientId;
		requestHeaders["authorization"] = `Basic ${base64.encode(`${primaryClientId}:${options.clientSecret ?? ""}`)}`;
	} else {
		const primaryClientId = Array.isArray(options.clientId) ? options.clientId[0] : options.clientId;
		body.set("client_id", primaryClientId);
		if (options.clientSecret) body.set("client_secret", options.clientSecret);
	}
	for (const [key, value] of Object.entries(additionalParams)) if (!body.has(key)) body.append(key, value);
	return {
		body,
		headers: requestHeaders
	};
}
async function validateAuthorizationCode({ code, codeVerifier, redirectURI, options, tokenEndpoint, authentication, deviceId, headers, additionalParams = {}, resource }) {
	const { body, headers: requestHeaders } = createAuthorizationCodeRequest({
		code,
		codeVerifier,
		redirectURI,
		options,
		authentication,
		deviceId,
		headers,
		additionalParams,
		resource
	});
	const { data, error } = await betterFetch(tokenEndpoint, {
		method: "POST",
		body,
		headers: requestHeaders
	});
	if (error) throw error;
	return getOAuth2Tokens(data);
}
async function validateToken(token, jwksEndpoint) {
	const { data, error } = await betterFetch(jwksEndpoint, {
		method: "GET",
		headers: { accept: "application/json" }
	});
	if (error) throw error;
	const keys = data["keys"];
	const header = JSON.parse(atob(token.split(".")[0]));
	const key = keys.find((key$1) => key$1.kid === header.kid);
	if (!key) throw new Error("Key not found");
	return await jwtVerify(token, key);
}

//#endregion
export { createAuthorizationCodeRequest, validateAuthorizationCode, validateToken };
//# sourceMappingURL=validate-authorization-code.mjs.map