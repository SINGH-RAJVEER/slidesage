import { Hono } from "hono";
import authClient from "../services/auth";
import {
  resendVerificationCode,
  signUpWithEmail,
  verifyEmailCode,
} from "../services/email-auth.service";

const authRoutes = new Hono();

// Custom endpoints for email verification flow
authRoutes.post("/signup/email", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password, name } = body;

  if (!email || !password || !name) {
    return c.json(
      {
        error: {
          message: "Email, password, and name are required",
        },
      },
      400,
    );
  }

  const result = await signUpWithEmail(email, password, name);

  if (!result.success) {
    return c.json(
      {
        error: {
          message: result.error || "Sign up failed",
        },
      },
      400,
    );
  }

  return c.json(
    {
      success: true,
      message: "Account created. Verification code sent to email.",
      userId: result.userId,
    },
    201,
  );
});

// Verify email code endpoint
authRoutes.post("/verify-code", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, code } = body;

  if (!email || !code) {
    return c.json(
      {
        error: {
          message: "Email and code are required",
        },
      },
      400,
    );
  }

  const result = await verifyEmailCode(email, code);

  if (!result.success) {
    return c.json(
      {
        error: {
          message: result.error || "Verification failed",
        },
      },
      400,
    );
  }

  return c.json({
    success: true,
    message: "Email verified successfully",
    user: result.user,
  });
});

// Resend verification code endpoint
authRoutes.post("/resend-code", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email } = body;

  if (!email) {
    return c.json(
      {
        error: {
          message: "Email is required",
        },
      },
      400,
    );
  }

  const result = await resendVerificationCode(email);

  if (!result.success) {
    return c.json(
      {
        error: {
          message: result.error || "Failed to resend code",
        },
      },
      400,
    );
  }

  return c.json({
    success: true,
    message: "Verification code sent",
  });
});

// All other auth routes handled by better-auth
authRoutes.all("/*", (c) => authClient.handler(c.req.raw));

export default authRoutes;
