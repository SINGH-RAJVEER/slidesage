import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import authRoutes from './routes/auth.routes';
import presentationRoutes from './routes/presentation.routes';
import { env } from 'bun';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => {
      const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'];
      // Allow all origins if CORS_ORIGINS is '*'
      if (process.env.CORS_ORIGINS === '*') {
        return origin || '*';
      }
      return allowedOrigins.includes(origin || '') ? origin || '*' : allowedOrigins[0];
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.route('/api/auth', authRoutes);
app.route('/api', presentationRoutes);

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: { message: 'Internal server error' } }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: { message: 'Resource not found' } }, 404);
});

const port = Number.parseInt(process.env.PORT || '8000');

console.log(`Starting server on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
