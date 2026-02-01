import { parseUserOutput } from "../../db/schema.mjs";
import { generateRandomString } from "../../crypto/random.mjs";
import { expireCookie, setSessionCookie } from "../../cookies/index.mjs";
import { getSessionFromCtx } from "../../api/routes/session.mjs";
import "../../api/index.mjs";
import { TWO_FACTOR_ERROR_CODES } from "./error-code.mjs";
import { TRUST_DEVICE_COOKIE_MAX_AGE, TRUST_DEVICE_COOKIE_NAME, TWO_FACTOR_COOKIE_NAME } from "./constant.mjs";
import { APIError } from "better-call";
import { createHMAC } from "@better-auth/utils/hmac";

//#region src/plugins/two-factor/verify-two-factor.ts
async function verifyTwoFactor(ctx) {
	const invalid = (errorKey) => {
		throw new APIError("UNAUTHORIZED", { message: TWO_FACTOR_ERROR_CODES[errorKey] });
	};
	const session = await getSessionFromCtx(ctx);
	if (!session) {
		const twoFactorCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
		const signedTwoFactorCookie = await ctx.getSignedCookie(twoFactorCookie.name, ctx.context.secret);
		if (!signedTwoFactorCookie) throw new APIError("UNAUTHORIZED", { message: TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE });
		const verificationToken = await ctx.context.internalAdapter.findVerificationValue(signedTwoFactorCookie);
		if (!verificationToken) throw new APIError("UNAUTHORIZED", { message: TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE });
		const user = await ctx.context.internalAdapter.findUserById(verificationToken.value);
		if (!user) throw new APIError("UNAUTHORIZED", { message: TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE });
		const dontRememberMe = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret);
		return {
			valid: async (ctx$1) => {
				const session$1 = await ctx$1.context.internalAdapter.createSession(verificationToken.value, !!dontRememberMe);
				if (!session$1) throw new APIError("INTERNAL_SERVER_ERROR", { message: "failed to create session" });
				await ctx$1.context.internalAdapter.deleteVerificationValue(verificationToken.id);
				await setSessionCookie(ctx$1, {
					session: session$1,
					user
				});
				expireCookie(ctx$1, twoFactorCookie);
				if (ctx$1.body.trustDevice) {
					const maxAge = ctx$1.context.getPlugin("two-factor").options.trustDeviceMaxAge ?? TRUST_DEVICE_COOKIE_MAX_AGE;
					const trustDeviceCookie = ctx$1.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge });
					/**
					* Create a random identifier for the trust device record.
					* Store it in the verification table with an expiration
					* so the server can validate and revoke it.
					*/
					const trustIdentifier = `trust-device-${generateRandomString(32)}`;
					const token = await createHMAC("SHA-256", "base64urlnopad").sign(ctx$1.context.secret, `${user.id}!${trustIdentifier}`);
					await ctx$1.context.internalAdapter.createVerificationValue({
						value: user.id,
						identifier: trustIdentifier,
						expiresAt: new Date(Date.now() + maxAge * 1e3)
					});
					await ctx$1.setSignedCookie(trustDeviceCookie.name, `${token}!${trustIdentifier}`, ctx$1.context.secret, trustDeviceCookie.attributes);
					expireCookie(ctx$1, ctx$1.context.authCookies.dontRememberToken);
				}
				return ctx$1.json({
					token: session$1.token,
					user: parseUserOutput(ctx$1.context.options, user)
				});
			},
			invalid,
			session: {
				session: null,
				user
			},
			key: signedTwoFactorCookie
		};
	}
	return {
		valid: async (ctx$1) => {
			return ctx$1.json({
				token: session.session.token,
				user: parseUserOutput(ctx$1.context.options, session.user)
			});
		},
		invalid,
		session,
		key: `${session.user.id}!${session.session.id}`
	};
}

//#endregion
export { verifyTwoFactor };
//# sourceMappingURL=verify-two-factor.mjs.map