import { Hono } from "hono";
import {
  authMiddleware,
  ensureUserInDbMiddleware,
  getCurrentUserId,
} from "../middleware/auth.middleware";
import { UserRepository } from "../repositories/user.repository";
import { AutumnBillingService } from "../services/autumn-billing.service";
import { updateClerkPublicMetadata } from "../services/clerk.service";
import { Webhook } from "svix";

function getAutumnWebhookSecret(): string | null {
  const secret = process.env.AUTUMN_WEBHOOK_SECRET?.trim();
  return secret ? secret : null;
}

async function syncCustomerBalanceToDbAndClerk(
  customerId: string,
): Promise<void> {
  const balance = await AutumnBillingService.getSlideTokenBalance(customerId);

  await UserRepository.findOrCreateByClerkId(customerId);
  await UserRepository.update(customerId, {
    slideTokens: balance.slideTokens,
    isUnlimited: balance.isUnlimited,
  });

  await updateClerkPublicMetadata({
    userId: customerId,
    publicMetadata: {
      // Clerk publicMetadata must be JSON-serializable; avoid Infinity.
      slide_tokens: balance.isUnlimited ? null : balance.slideTokens,
      is_unlimited: balance.isUnlimited,
    },
  });
}

function getFrontendUrlFromRequest(originHeader: string | undefined): string {
  const fallback = process.env.FRONTEND_URL || "http://localhost:5173";
  const origin = originHeader?.trim();
  if (!origin) return fallback;

  // Keep it simple/safe: only allow absolute http(s) origins.
  try {
    const url = new URL(origin);
    if (url.protocol === "http:" || url.protocol === "https:")
      return url.origin;
  } catch {
    // ignore
  }

  return fallback;
}

function getProductIdForPack(pack: string): string {
  const normalized = pack.trim().toLowerCase();

  const envVarByPack: Record<string, string> = {
    starter: "AUTUMN_PRODUCT_STARTER_ID",
    pro: "AUTUMN_PRODUCT_PRO_ID",
    premium: "AUTUMN_PRODUCT_PREMIUM_ID",
    custom: "AUTUMN_PRODUCT_CUSTOM_ID",
  };

  const envVar = envVarByPack[normalized];
  if (!envVar) throw new Error("Invalid pack");

  const value = process.env[envVar]?.trim();
  if (value) return value;

  throw new Error(
    `Missing ${envVar} for pack "${normalized}". Set it in your .env (or pass productId explicitly).`,
  );
}

const billing = new Hono();

billing.get("/balance", authMiddleware, ensureUserInDbMiddleware, async (c) => {
  const userId = getCurrentUserId(c);

  const balance = await AutumnBillingService.getSlideTokenBalance(userId);

  // Best-effort sync into our DB + Clerk metadata so the UI stays in sync.
  try {
    await syncCustomerBalanceToDbAndClerk(userId);
  } catch (err) {
    console.warn("Failed to sync balance to DB/Clerk:", err);
  }

  return c.json(
    {
      slide_tokens: balance.slideTokens,
      is_unlimited: balance.isUnlimited,
    },
    200,
  );
});

billing.post(
  "/checkout",
  authMiddleware,
  ensureUserInDbMiddleware,
  async (c) => {
    const userId = getCurrentUserId(c);
    const body = await c.req.json().catch(() => ({}));

    const pack = typeof body?.pack === "string" ? body.pack : undefined;
    const productId =
      typeof body?.productId === "string" ? body.productId : undefined;

    const effectivePack = pack || "starter";

    let effectiveProductId: string;
    try {
      effectiveProductId = productId || getProductIdForPack(effectivePack);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid product";
      return c.json({ error: { message } }, 400);
    }

    const frontendOrigin = getFrontendUrlFromRequest(c.req.header("Origin"));

    const successUrl = `${frontendOrigin}/purchase?status=success`;
    const cancelUrl = `${frontendOrigin}/purchase?status=cancel`;

    const quantity =
      typeof body?.quantity === "number" ? body.quantity : undefined;

    const options =
      typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0
        ? [{ feature_id: AutumnBillingService.getFeatureId(), quantity }]
        : undefined;

    try {
      const url = await AutumnBillingService.createCheckoutUrl({
        customerId: userId,
        productId: effectiveProductId,
        successUrl,
        cancelUrl,
        options,
        metadata: {
          pack: effectivePack,
          quantity: typeof quantity === "number" ? String(quantity) : "",
        },
      });

      if (!url) {
        return c.json(
          { error: { message: "Checkout did not return a URL" } },
          500,
        );
      }

      return c.json({ url }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Checkout failed";
      const code = (err as any)?.code;
      console.error("Billing checkout failed", {
        userId,
        pack: effectivePack,
        productId: effectiveProductId,
        quantity,
        origin: c.req.header("Origin"),
        code,
        message,
      });
      return c.json({ error: { message, code: code ?? undefined } }, 500);
    }
  },
);

// Optional: Autumn webhooks (Svix-signed). Useful for syncing balances
// automatically after purchases / plan changes without waiting for the client to poll.
billing.post("/webhook", async (c) => {
  const secret = getAutumnWebhookSecret();
  if (!secret) {
    return c.json(
      {
        error: {
          message:
            "Webhook secret missing. Set AUTUMN_WEBHOOK_SECRET to enable billing webhooks.",
        },
      },
      500,
    );
  }

  const payload = await c.req.text();

  const svixId = c.req.header("svix-id");
  const svixTimestamp = c.req.header("svix-timestamp");
  const svixSignature = c.req.header("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json(
      { error: { message: "Missing Svix signature headers" } },
      400,
    );
  }

  type AutumnWebhookEvent = {
    type?: string;
    data?: {
      customer?: { id?: string };
      customer_id?: string;
      customerId?: string;
    };
  };

  let event: AutumnWebhookEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as AutumnWebhookEvent;
  } catch (err) {
    console.warn("Autumn webhook signature verification failed:", err);
    return c.json({ error: { message: "Invalid signature" } }, 400);
  }

  const customerId =
    typeof event?.data?.customer?.id === "string"
      ? event.data.customer.id
      : typeof event?.data?.customer_id === "string"
        ? event.data.customer_id
        : typeof event?.data?.customerId === "string"
          ? event.data.customerId
          : null;

  if (customerId) {
    try {
      await syncCustomerBalanceToDbAndClerk(customerId);
    } catch (err) {
      console.warn("Autumn webhook balance sync failed:", err);
      return c.json(
        { error: { message: "Failed to sync customer balance" } },
        500,
      );
    }
  }

  return c.json({ received: true, type: event?.type ?? null }, 200);
});

export default billing;
