import * as z from "zod";

//#region src/db/schema/rate-limit.d.ts
declare const rateLimitSchema: z.ZodObject<{
  key: z.ZodString;
  count: z.ZodNumber;
  lastRequest: z.ZodNumber;
}, z.core.$strip>;
/**
 * Rate limit schema type used by better-auth for rate limiting
 */
type RateLimit = z.infer<typeof rateLimitSchema>;
//#endregion
export { RateLimit, rateLimitSchema };
//# sourceMappingURL=rate-limit.d.mts.map