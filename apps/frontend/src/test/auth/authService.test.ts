/// <reference lib="dom" />

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { authService } from "../../features/auth/services/authService";

// Mock fetch
const mockFetch = mock(() => {});
global.fetch = mockFetch as any;

describe("AuthService", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    localStorage.clear();
  });

  describe("login", () => {
    it("should login successfully", async () => {
      const mockResponse = {
        success: true,
        user: {
          id: 1,
          email: "test@example.com",
          name: "Test",
          slide_tokens: 50,
        },
        access_token: "access_token",
        refresh_token: "refresh_token",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await authService.login({
        email: "test@example.com",
        password: "password123",
      });

      expect(result.success).toBe(true);
      expect(result.user?.email).toBe("test@example.com");
      expect(localStorage.getItem("access_token")).toBe("access_token");
      expect(localStorage.getItem("refresh_token")).toBe("refresh_token");
    });

    it("should handle login error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Invalid credentials" } }),
      } as Response);

      const result = await authService.login({
        email: "test@example.com",
        password: "wrong",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("register", () => {
    it("should register successfully", async () => {
      const mockResponse = {
        success: true,
        user: {
          id: 1,
          email: "new@example.com",
          name: "New User",
          slide_tokens: 50,
        },
        access_token: "access_token",
        refresh_token: "refresh_token",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await authService.register({
        email: "new@example.com",
        password: "password123",
        name: "New User",
      });

      expect(result.success).toBe(true);
      expect(result.user?.email).toBe("new@example.com");
    });
  });

  describe("getCurrentUser", () => {
    it("should get current user", async () => {
      localStorage.setItem("access_token", "valid_token");

      const mockUser = {
        id: 1,
        email: "test@example.com",
        name: "Test",
        slide_tokens: 50,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: mockUser }),
      } as Response);

      const user = await authService.getCurrentUser();

      expect(user?.email).toBe("test@example.com");
    });

    it("should return null when not authenticated", async () => {
      const user = await authService.getCurrentUser();
      expect(user).toBeNull();
    });
  });

  describe("logout", () => {
    it("should clear tokens on logout", async () => {
      localStorage.setItem("access_token", "token");
      localStorage.setItem("refresh_token", "refresh");

      await authService.logout();

      expect(localStorage.getItem("access_token")).toBeNull();
      expect(localStorage.getItem("refresh_token")).toBeNull();
    });
  });

  describe("googleLogin", () => {
    it("should login with Google", async () => {
      const mockResponse = {
        success: true,
        user: {
          id: 1,
          email: "google@example.com",
          name: "Google User",
          slide_tokens: 50,
        },
        access_token: "access_token",
        refresh_token: "refresh_token",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await authService.googleLogin("google_credential");

      expect(result.success).toBe(true);
      expect(result.user?.email).toBe("google@example.com");
    });
  });
});
