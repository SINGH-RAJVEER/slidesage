import { Hono } from 'hono';
import authClient from '../services/auth';

const authRoutes = new Hono();

authRoutes.all('/*', (c) => authClient.handler(c.req.raw));

export default authRoutes;
