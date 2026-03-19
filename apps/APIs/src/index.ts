import { config as loadEnv } from "dotenv";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import authRoutes from "./routes/auth.routes";
import billingRoutes from "./routes/billing.routes";
import presentationRoutes from "./routes/presentation.routes";
import profileRoutes from "./routes/profile.routes";

loadEnv({ path: new URL("../../../.env", import.meta.url), override: false });

const app = new Hono();

const corsOrigins = process.env.CORS_ORIGINS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const corsOriginConfig =
  corsOrigins && corsOrigins.length > 0 ? corsOrigins : "*";

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: corsOriginConfig,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.route("/api/auth", authRoutes);
app.route("/api/profile", profileRoutes);
app.route("/api", presentationRoutes);
app.route("/api/billing", billingRoutes);

const frontendDistPath = resolve(import.meta.dir, "../../Web/dist");
const frontendIndexPath = resolve(frontendDistPath, "index.html");
const shouldServeFrontend = existsSync(frontendIndexPath);

if (shouldServeFrontend) {
  const serveFrontendAssets = serveStatic({ root: frontendDistPath });
  const frontendIndexFile = Bun.file(frontendIndexPath);

  app.use("/assets/*", serveFrontendAssets);
  app.use("/favicon.ico", serveFrontendAssets);
  app.use("/robots.txt", serveFrontendAssets);
  app.use("/manifest.webmanifest", serveFrontendAssets);

  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) {
      return next();
    }

    const indexHtml = await frontendIndexFile.text();
    return c.html(indexHtml);
  });

  console.log(`Serving frontend bundle from ${frontendDistPath}`);
} else {
  console.log(
    `Frontend bundle not found at ${frontendIndexPath}; API-only mode`,
  );
}

app.onError((err, c) => {
  console.error("Error:", err);
  return c.json({ error: { message: "Internal server error" } }, 500);
});

app.notFound((c) => {
  return c.json({ error: { message: "Resource not found" } }, 404);
});

const port = Number.parseInt(process.env.PORT || "8000", 10);

console.log(`Server started on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
