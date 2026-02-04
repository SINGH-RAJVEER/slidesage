import { Autumn } from "autumn-js";

export interface SlideTokenBalance {
  slideTokens: number;
  isUnlimited: boolean;
}

function getAutumnSecretKey(): string {
  // Prefer AUTUMN_API_KEY (current naming), but allow legacy AUTUMN_SECRET_KEY.
  const key = process.env.AUTUMN_API_KEY ?? process.env.AUTUMN_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Autumn API key missing. Set AUTUMN_API_KEY (or legacy AUTUMN_SECRET_KEY).",
    );
  }
  return key;
}

function getSlideTokensFeatureId(): string {
  return process.env.AUTUMN_SLIDE_TOKENS_FEATURE_ID?.trim() || "slide_tokens";
}

let cachedAutumn: Autumn | null = null;

function getAutumnClient(): Autumn {
  if (!cachedAutumn) {
    cachedAutumn = new Autumn({
      secretKey: getAutumnSecretKey(),
    });
  }

  return cachedAutumn;
}

export class AutumnBillingService {
  static getFeatureId(): string {
    return getSlideTokensFeatureId();
  }

  static async getSlideTokenBalance(
    customerId: string,
  ): Promise<SlideTokenBalance> {
    const autumn = getAutumnClient();

    const { data, error } = await autumn.check({
      customer_id: customerId,
      feature_id: getSlideTokensFeatureId(),
      required_balance: 0,
    });

    if (error) throw error;

    return {
      slideTokens: typeof data?.balance === "number" ? data.balance : 0,
      isUnlimited: Boolean(data?.unlimited),
    };
  }

  static async hasSufficientSlideTokens(
    customerId: string,
    requiredBalance: number,
  ): Promise<{ allowed: boolean; balance: number; unlimited: boolean }> {
    const autumn = getAutumnClient();

    const { data, error } = await autumn.check({
      customer_id: customerId,
      feature_id: getSlideTokensFeatureId(),
      required_balance: requiredBalance,
    });

    if (error) throw error;

    return {
      allowed: Boolean(data?.allowed),
      balance: typeof data?.balance === "number" ? data.balance : 0,
      unlimited: Boolean(data?.unlimited),
    };
  }

  static async deductSlideTokens(
    customerId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<void> {
    // The `autumn-js` SDK currently strips unknown fields via zod (including
    // `overage_behavior`). We call the REST endpoint directly so "reject" is
    // actually transmitted.
    const res = await fetch("https://api.useautumn.com/v1/track", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getAutumnSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_id: customerId,
        feature_id: getSlideTokensFeatureId(),
        value: amount,
        idempotency_key: idempotencyKey,
        overage_behavior: "reject",
      }),
    });

    if (!res.ok) {
      let details: any = null;
      try {
        details = await res.json();
      } catch {
        // ignore
      }

      const message =
        typeof details?.message === "string"
          ? details.message
          : `Autumn track failed (${res.status})`;

      throw new Error(message);
    }
  }

  static async refundSlideTokens(
    customerId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<void> {
    if (amount <= 0) return;

    const res = await fetch("https://api.useautumn.com/v1/track", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getAutumnSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_id: customerId,
        feature_id: getSlideTokensFeatureId(),
        value: -amount,
        idempotency_key: idempotencyKey,
      }),
    });

    if (!res.ok) {
      let details: any = null;
      try {
        details = await res.json();
      } catch {
        // ignore
      }

      const message =
        typeof details?.message === "string"
          ? details.message
          : `Autumn refund failed (${res.status})`;

      throw new Error(message);
    }
  }

  static async createCheckoutUrl(params: {
    customerId: string;
    productId: string;
    successUrl: string;
    cancelUrl?: string;
    options?: Array<{ feature_id: string; quantity: number }>;
    metadata?: Record<string, string>;
  }): Promise<string | null> {
    const autumn = getAutumnClient();

    const { data, error } = await autumn.attach({
      customer_id: params.customerId,
      product_id: params.productId,
      success_url: params.successUrl,
      force_checkout: true,
      options: params.options,
      metadata: params.metadata,
      checkout_session_params: params.cancelUrl
        ? { cancel_url: params.cancelUrl }
        : undefined,
    });

    if (error) throw error;

    return (data as any)?.checkout_url ?? (data as any)?.url ?? null;
  }
}
