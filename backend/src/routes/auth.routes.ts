import { Hono } from 'hono';
import { auth as betterAuth } from '../lib/auth';
import { authMiddleware, getCurrentUserId } from '../middleware/auth.middleware';
import { AuthService } from '../services/auth.service';

const auth = new Hono();
const authService = new AuthService();

// Get current user
auth.get('/me', async (c) => {
  const session = await betterAuth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: { message: 'Not authenticated' } }, 401);
  }

  return c.json({ user: session.user }, 200);
});

// Update profile
auth.put('/profile', authMiddleware, async (c) => {
  try {
    const userId = getCurrentUserId(c);
    const body = await c.req.json();

    const user = await authService.updateProfile(userId, {
      name: body.name,
      email: body.email,
      currentPassword: body.current_password,
      newPassword: body.new_password,
    });

    return c.json({ user: authService.userToDict(user) }, 200);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: { message } }, 400);
  }
});

// Logout
auth.post('/logout', authMiddleware, async (c) => {
  return c.json({ message: 'Logged out successfully' }, 200);
});

// Mount Better Auth handlers - this handles all other auth routes
auth.on(['POST', 'GET'], '/*', (c) => betterAuth.handler(c.req.raw));

export default auth;
