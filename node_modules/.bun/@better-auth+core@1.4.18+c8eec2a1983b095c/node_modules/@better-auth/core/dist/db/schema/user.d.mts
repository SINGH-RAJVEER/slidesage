import * as z from "zod";

//#region src/db/schema/user.d.ts
declare const userSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
  emailVerified: z.ZodDefault<z.ZodBoolean>;
  name: z.ZodString;
  image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/**
 * User schema type used by better-auth, note that it's possible that user could have additional fields
 *
 * todo: we should use generics to extend this type with additional fields from plugins and options in the future
 */
type User = z.infer<typeof userSchema>;
//#endregion
export { User, userSchema };
//# sourceMappingURL=user.d.mts.map