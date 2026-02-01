import { createAuthClient } from "better-auth/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const authClient = createAuthClient({
  baseURL: API_URL,
});

export type Session = typeof authClient.$Infer.Session;
