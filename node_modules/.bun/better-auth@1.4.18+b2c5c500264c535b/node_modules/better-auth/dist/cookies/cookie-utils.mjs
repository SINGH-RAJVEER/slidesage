//#region src/cookies/cookie-utils.ts
const SECURE_COOKIE_PREFIX = "__Secure-";
const HOST_COOKIE_PREFIX = "__Host-";
/**
* Remove __Secure- or __Host- prefix from cookie name.
*/
function stripSecureCookiePrefix(cookieName) {
	if (cookieName.startsWith(SECURE_COOKIE_PREFIX)) return cookieName.slice(9);
	if (cookieName.startsWith(HOST_COOKIE_PREFIX)) return cookieName.slice(7);
	return cookieName;
}
/**
* Split `Set-Cookie` header, handling commas in `Expires` dates.
*/
function splitSetCookieHeader(setCookie) {
	if (!setCookie) return [];
	const result = [];
	let current = "";
	let i = 0;
	while (i < setCookie.length) {
		const c = setCookie[i];
		if (c === ",") {
			const lower = current.toLowerCase();
			if (lower.includes("expires=") && !lower.includes("gmt")) {
				current += c;
				i++;
			} else {
				const trimmed$1 = current.trim();
				if (trimmed$1) result.push(trimmed$1);
				current = "";
				i++;
				if (i < setCookie.length && setCookie[i] === " ") i++;
			}
			continue;
		}
		current += c;
		i++;
	}
	const trimmed = current.trim();
	if (trimmed) result.push(trimmed);
	return result;
}
function parseSetCookieHeader(setCookie) {
	const cookies = /* @__PURE__ */ new Map();
	splitSetCookieHeader(setCookie).forEach((cookieString) => {
		const [nameValue, ...attributes] = cookieString.split(";").map((part) => part.trim());
		const [name, ...valueParts] = (nameValue || "").split("=");
		const value = valueParts.join("=");
		if (!name || value === void 0) return;
		const attrObj = { value };
		attributes.forEach((attribute) => {
			const [attrName, ...attrValueParts] = attribute.split("=");
			const attrValue = attrValueParts.join("=");
			const normalizedAttrName = attrName.trim().toLowerCase();
			switch (normalizedAttrName) {
				case "max-age":
					attrObj["max-age"] = attrValue ? parseInt(attrValue.trim(), 10) : void 0;
					break;
				case "expires":
					attrObj.expires = attrValue ? new Date(attrValue.trim()) : void 0;
					break;
				case "domain":
					attrObj.domain = attrValue ? attrValue.trim() : void 0;
					break;
				case "path":
					attrObj.path = attrValue ? attrValue.trim() : void 0;
					break;
				case "secure":
					attrObj.secure = true;
					break;
				case "httponly":
					attrObj.httponly = true;
					break;
				case "samesite":
					attrObj.samesite = attrValue ? attrValue.trim().toLowerCase() : void 0;
					break;
				default:
					attrObj[normalizedAttrName] = attrValue ? attrValue.trim() : true;
					break;
			}
		});
		cookies.set(name, attrObj);
	});
	return cookies;
}
function setCookieToHeader(headers) {
	return (context) => {
		const setCookieHeader = context.response.headers.get("set-cookie");
		if (!setCookieHeader) return;
		const cookieMap = /* @__PURE__ */ new Map();
		(headers.get("cookie") || "").split(";").forEach((cookie) => {
			const [name, ...rest] = cookie.trim().split("=");
			if (name && rest.length > 0) cookieMap.set(name, rest.join("="));
		});
		parseSetCookieHeader(setCookieHeader).forEach((value, name) => {
			cookieMap.set(name, value.value);
		});
		const updatedCookies = Array.from(cookieMap.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
		headers.set("cookie", updatedCookies);
	};
}

//#endregion
export { HOST_COOKIE_PREFIX, SECURE_COOKIE_PREFIX, parseSetCookieHeader, setCookieToHeader, splitSetCookieHeader, stripSecureCookiePrefix };
//# sourceMappingURL=cookie-utils.mjs.map