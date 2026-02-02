import type { Context } from "hono";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { UserRepository } from "../repositories/user.repository";

export const authMiddleware = clerkMiddleware();

// Ensure an authenticated Clerk user exists in our database.
// Must run AFTER `authMiddleware` and BEFORE route handlers.
export async function ensureUserInDbMiddleware(
  c: Context,
  next: () => Promise<void>,
): Promise<void> {
  const auth = getAuth(c);

  if (!auth?.userId) throw new Error("User not authenticated");

  await UserRepository.findOrCreateByClerkId(auth.userId);
  await next();
}

type ClerkAuth = ReturnType<typeof getAuth>;

export function getCurrentUser(c: Context): NonNullable<ClerkAuth> {
  const auth = getAuth(c);

  if (!auth?.userId) throw new Error("User not authenticated");
  
  return auth as NonNullable<ClerkAuth>;
}

export function getCurrentUserId(c: Context): string {
  const auth = getAuth(c);

  if (!auth?.userId) throw new Error("User not authenticated");
  
  return auth.userId;
}
