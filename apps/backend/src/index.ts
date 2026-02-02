import { config as loadEnv } from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import presentationRoutes from "./routes/presentation.routes";

// Ensure env vars are available when running backend from `apps/backend`
// (turbo runs `bun --watch src/index.ts` with CWD = apps/backend)
loadEnv({ path: new URL("../../../.env", import.meta.url) });

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      const corsOrigins = process.env.CORS_ORIGINS;
      // Allow all origins if CORS_ORIGINS is '*' or '"*"' or empty (dev convenience)
      if (
        !corsOrigins ||
        corsOrigins === "*" ||
        corsOrigins === '"*"' ||
        corsOrigins === "'*'"
      ) {
        return origin || "*";
      }
      const allowedOrigins = corsOrigins.split(",").map((o) => o.trim());
      return allowedOrigins.includes(origin || "")
        ? origin || "*"
        : allowedOrigins[0];
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes

app.route("/api", presentationRoutes);

// Error handler
app.onError((err, c) => {
  console.error("Error:", err);
  return c.json({ error: { message: "Internal server error" } }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: { message: "Resource not found" } }, 404);
});

const port = Number.parseInt(process.env.PORT || "8000");

console.log(`Starting server on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
