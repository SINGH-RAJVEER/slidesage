import type { Context, Next } from 'hono';
import { auth } from '../lib/auth';

export async function authMiddleware(c: Context, next: Next) {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: { message: 'Missing or invalid authorization' } }, 401);
  }

  c.set('user', session.user);
  c.set('session', session.session);
  await next();
}

export function getCurrentUser(c: Context) {
  const user = c.get('user');
  if (!user) {
    throw new Error('User not authenticated');
  }
  return user;
}

export function getCurrentUserId(c: Context): string {
  const user = getCurrentUser(c);
  return user.id;
}
