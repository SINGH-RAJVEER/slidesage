import { db } from "@slide-sage/db";
import { accounts, users, verifications } from "@slide-sage/db";
import { eq } from "drizzle-orm";
import {
  generateVerificationCode,
  getCodeExpirationTime,
  hashVerificationCode,
  isCodeExpired,
  verifyCode,
} from "../utils/verification-code";
import { sendVerificationEmail } from "./email.service";

/**
 * Hash password using Bun's built-in crypto
 */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sign up a new user with email and password
 * Creates an unverified user account and sends verification code
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  name: string,
): Promise<{
  success: boolean;
  error?: string;
  userId?: string;
}> {
  try {
    // Check if user already exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      return { success: false, error: "Email already registered" };
    }

    // Generate user ID and hash password
    const userId = crypto.randomUUID();
    const hashedPassword = await hashPassword(password);

    // Create unverified user in database
    await db.insert(users).values({
      id: userId,
      email,
      name,
      emailVerified: false,
    });

    // Store password in accounts table for email/password authentication
    const accountId = crypto.randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      userId,
      accountId: email,
      providerId: "email",
      password: hashedPassword,
    });

    // Generate verification code
    const code = generateVerificationCode();
    const hashedCode = hashVerificationCode(code);
    const expiresAt = getCodeExpirationTime();

    // Store verification code
    await db.insert(verifications).values({
      identifier: email,
      value: hashedCode,
      expiresAt,
    });

    // Send verification email
    const emailResult = await sendVerificationEmail(email, code, name);
    if (!emailResult.success) {
      // Don't fail signup if email fails, user can still verify later
      console.error("Failed to send verification email:", emailResult.error);
    }

    return {
      success: true,
      userId,
    };
  } catch (error) {
    console.error("Sign up error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Sign up failed",
    };
  }
}

/**
 * Verify email using the code sent to user
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{
  success: boolean;
  error?: string;
  user?: typeof users.$inferSelect;
}> {
  try {
    // Find verification record
    const verification = await db.query.verifications.findFirst({
      where: eq(verifications.identifier, email),
    });

    if (!verification) {
      return { success: false, error: "No verification code found" };
    }

    // Check if expired
    if (isCodeExpired(verification.expiresAt)) {
      await db
        .delete(verifications)
        .where(eq(verifications.id, verification.id));
      return { success: false, error: "Verification code expired" };
    }

    // Verify code
    if (!verifyCode(code, verification.value)) {
      return { success: false, error: "Invalid verification code" };
    }

    // Mark user as verified
    const result = await db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.email, email))
      .returning();

    if (!result || result.length === 0) {
      return { success: false, error: "User not found" };
    }

    // Delete verification code
    await db.delete(verifications).where(eq(verifications.id, verification.id));

    return {
      success: true,
      user: result[0],
    };
  } catch (error) {
    console.error("Email verification error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

/**
 * Resend verification code to user
 */
export async function resendVerificationCode(email: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Delete existing code if any
    await db.delete(verifications).where(eq(verifications.identifier, email));

    // Generate new code
    const code = generateVerificationCode();
    const hashedCode = hashVerificationCode(code);
    const expiresAt = getCodeExpirationTime();

    // Store verification code
    await db.insert(verifications).values({
      identifier: email,
      value: hashedCode,
      expiresAt,
    });

    // Send email
    const emailResult = await sendVerificationEmail(
      email,
      code,
      user.name || "",
    );
    if (!emailResult.success) {
      return {
        success: false,
        error: emailResult.error || "Failed to send verification email",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Resend code error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to resend code",
    };
  }
}
