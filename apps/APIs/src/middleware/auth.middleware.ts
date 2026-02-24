import { db } from '@slide-sage/db';
import { sessions, users } from '@slide-sage/db';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

/**
 * Extract session from cookies and verify it
 */
async function getSessionFromCookie(
  c: Context
): Promise<{ userId: string; sessionId: string } | null> {
  const sessionCookie = getCookie(c, 'better-auth.session_token');

  if (!sessionCookie) {
    return null;
  }

  // Query session from database
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionCookie)).limit(1);

  if (!session || new Date(session.expiresAt) < new Date()) {
    return null; // Session expired
  }

  return {
    userId: session.userId,
    sessionId: session.id,
  };
}

/**
 * Middleware that checks if user is authenticated
 * Attaches userId and sessionId to context
 */
export async function authMiddleware(c: Context, next: () => Promise<void>): Promise<void> {
  const auth = await getSessionFromCookie(c);

  if (!auth) {
    return c.json({ error: { message: 'Unauthorized' } }, 401);
  }

  // Attach to context
  c.set('userId', auth.userId);
  c.set('sessionId', auth.sessionId);

  await next();
}

/**
 * Get current user ID from context
 */
export function getCurrentUserId(c: Context): string {
  const userId = c.get('userId');
  if (!userId) {
    throw new Error('User not authenticated');
  }
  return userId;
}

/**
 * Get current session ID from context
 */
export function getCurrentSessionId(c: Context): string {
  const sessionId = c.get('sessionId');
  if (!sessionId) {
    throw new Error('Session not found');
  }
  return sessionId;
}

/**
 * Ensure authenticated user exists in database
 * (useful after OAuth callback)
 */
export async function ensureUserInDbMiddleware(
  c: Context,
  next: () => Promise<void>
): Promise<void> {
  const userId = getCurrentUserId(c);

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user || !user[0]) {
    return c.json({ error: { message: 'User not found' } }, 404);
  }

  await next();
}
