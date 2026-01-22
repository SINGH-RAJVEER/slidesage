import { authClient } from "../../../lib/auth-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export type User = {
  id: string;
  email: string;
  name: string;
  image?: string;
  slide_tokens: number;
  emailVerified: boolean;
  createdAt?: string;
};

export type AuthResponse = {
  success: boolean;
  message?: string;
  user?: User;
  error?: string;
};

export type LoginCredentials = {
  email: string;
  password: string;
};

export type RegisterCredentials = {
  name: string;
  email: string;
  password: string;
};

export type UpdateProfileData = {
  name?: string;
  email?: string;
  image?: string;
};

class AuthService {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const { data, error } = await authClient.signIn.email(credentials);

      if (error) {
        return {
          success: false,
          error: error.message || "Login failed",
        };
      }

      return {
        success: true,
        user: data?.user as User,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Login failed",
      };
    }
  }

  async register(credentials: RegisterCredentials): Promise<AuthResponse> {
    try {
      const { data, error } = await authClient.signUp.email({
        email: credentials.email,
        password: credentials.password,
        name: credentials.name,
      });

      if (error) {
        return {
          success: false,
          error: error.message || "Registration failed",
        };
      }

      return {
        success: true,
        user: data?.user as User,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Registration failed",
      };
    }
  }

  async logout(): Promise<void> {
    await authClient.signOut();
  }

  async getCurrentUser(): Promise<User | null> {
    try {
      const { data } = await authClient.getSession();
      return data?.user as User | null;
    } catch (error) {
      return null;
    }
  }

  async googleLogin(credential: string): Promise<AuthResponse> {
    // Better Auth handles Google OAuth differently
    // This would typically be done through a redirect flow
    try {
      const response = await fetch(`${API_URL}/api/auth/callback/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ credential }),
      });

      const data = await response.json();

      if (data.error) {
        return {
          success: false,
          error: data.error.message || "Google login failed",
        };
      }

      const user = await this.getCurrentUser();
      return {
        success: true,
        user: user || undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Google login failed",
      };
    }
  }

  async updateProfile(data: UpdateProfileData): Promise<AuthResponse> {
    try {
      // Better Auth doesn't have a built-in update profile
      // We would need to implement this in the backend
      const response = await fetch(`${API_URL}/api/auth/update-profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.error) {
        return {
          success: false,
          error: result.error.message || "Update failed",
        };
      }

      return {
        success: true,
        user: result.user,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Update failed",
      };
    }
  }
}

export const authService = new AuthService();
      // Handle errors - clear tokens for 422, 500, or other failures
      if (response.status === 422 || response.status === 500 || !response.ok) {
        console.warn("Invalid or expired refresh token, clearing tokens");
        this.clearTokens();
        return false;
      }

      const data = await response.json();

      // New API format: {access_token: "..."} on success
      if (data.access_token) {
        const currentRefreshToken = this.getRefreshToken();
        if (currentRefreshToken) {
          localStorage.setItem("access_token", data.access_token);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error("Refresh token error:", error);
      this.clearTokens();
      return false;
    }
  }

  isAuthenticated(): boolean {
    return this.getToken() !== null;
  }

  getAuthHeaders(): Record<string, string> {
    const token = this.getToken();
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  async updateProfile(data: UpdateProfileData): Promise<AuthResponse> {
    const token = this.getToken();

    if (!token) {
      return {
        success: false,
        error: "Not authenticated",
      };
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      // Handle new API error format: {error: {message: "..."}}
      if (result.error) {
        return {
          success: false,
          error:
            typeof result.error === "object"
              ? result.error.message
              : result.error,
        };
      }

      // Handle success response: {user: {...}}
      if (result.user) {
        return {
          success: true,
          user: result.user,
        };
      }

      return {
        success: false,
        error: "Invalid response from server",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }
}

export const authService = new AuthService();
