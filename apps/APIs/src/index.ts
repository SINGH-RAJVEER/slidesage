import { config as loadEnv } from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import presentationRoutes from "./routes/presentation.routes";
import billingRoutes from "./routes/billing.routes";

loadEnv({ path: new URL("../../../.env", import.meta.url) });

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      const corsOrigins = process.env.CORS_ORIGINS;

      const normalizeOrigin = (value: string) =>
        value.trim().replace(/\/+$/, "");

      if (!corsOrigins) return origin || "*";

      const configured = corsOrigins
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      if (configured.includes("*")) return origin || "*";

      if (!origin) return "*";

      const normalizedOrigin = normalizeOrigin(origin);
      const allowList = new Set(configured.map(normalizeOrigin));

      return allowList.has(normalizedOrigin) ? origin : undefined;
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
app.route("/api/billing", billingRoutes);

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
