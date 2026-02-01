import * as z from "zod";

//#region src/db/schema/account.d.ts
declare const accountSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  providerId: z.ZodString;
  accountId: z.ZodString;
  userId: z.ZodCoercedString<unknown>;
  accessToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  refreshToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  idToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  accessTokenExpiresAt: z.ZodOptional<z.ZodNullable<z.ZodDate>>;
  refreshTokenExpiresAt: z.ZodOptional<z.ZodNullable<z.ZodDate>>;
  scope: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  password: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/**
 * Account schema type used by better-auth, note that it's possible that account could have additional fields
 *
 * todo: we should use generics to extend this type with additional fields from plugins and options in the future
 */
type Account = z.infer<typeof accountSchema>;
//#endregion
export { Account, accountSchema };
//# sourceMappingURL=account.d.mts.map