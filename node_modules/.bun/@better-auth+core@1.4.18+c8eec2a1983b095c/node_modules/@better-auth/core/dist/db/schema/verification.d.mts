import * as z from "zod";

//#region src/db/schema/verification.d.ts
declare const verificationSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  value: z.ZodString;
  expiresAt: z.ZodDate;
  identifier: z.ZodString;
}, z.core.$strip>;
/**
 * Verification schema type used by better-auth, note that it's possible that verification could have additional fields
 *
 * todo: we should use generics to extend this type with additional fields from plugins and options in the future
 */
type Verification = z.infer<typeof verificationSchema>;
//#endregion
export { Verification, verificationSchema };
//# sourceMappingURL=verification.d.mts.map