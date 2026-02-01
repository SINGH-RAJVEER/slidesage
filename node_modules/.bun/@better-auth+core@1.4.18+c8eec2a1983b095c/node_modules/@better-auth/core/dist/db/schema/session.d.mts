import * as z from "zod";

//#region src/db/schema/session.d.ts
declare const sessionSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  userId: z.ZodCoercedString<unknown>;
  expiresAt: z.ZodDate;
  token: z.ZodString;
  ipAddress: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  userAgent: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/**
 * Session schema type used by better-auth, note that it's possible that session could have additional fields
 *
 * todo: we should use generics to extend this type with additional fields from plugins and options in the future
 */
type Session = z.infer<typeof sessionSchema>;
//#endregion
export { Session, sessionSchema };
//# sourceMappingURL=session.d.mts.map