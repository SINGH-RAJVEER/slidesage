import { Hono } from "hono";
import { toWebHandler } from "better-auth/hono";
import authClient from "../services/auth";

const authRoutes = new Hono();

// Mount better-auth routes (handles /api/auth/signin, /api/auth/callback, etc.)
authRoutes.all("/*", toWebHandler(authClient));

export default authRoutes;
