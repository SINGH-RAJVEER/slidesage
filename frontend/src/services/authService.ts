const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export type User = {
  id: number;
  email: string;
  name: string;
  profile_picture?: string;
  slide_tokens: number;
  created_at?: string;
};

export type AuthResponse = {
  success: boolean;
  message?: string;
  user?: User;
  access_token?: string;
  refresh_token?: string;
  error?: string;
};

export type LoginCredentials = {
  email: string;
  password: string;
};

export type RegisterCredentials = {
  name?: string;
  email: string;
  password: string;
};

export type UpdateProfileData = {
  name?: string;
  email?: string;
  password?: string;
  profile_picture?: string;
};

class AuthService {
  private getToken(): string | null {
    return localStorage.getItem("access_token");
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem("refresh_token");
  }

  private setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("refresh_token", refreshToken);
  }

  private clearTokens(): void {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  }

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      const data: AuthResponse = await response.json();

      if (data.success && data.access_token && data.refresh_token) {
        this.setTokens(data.access_token, data.refresh_token);
      }

      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  async register(credentials: RegisterCredentials): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      const data: AuthResponse = await response.json();

      if (data.success && data.access_token && data.refresh_token) {
        this.setTokens(data.access_token, data.refresh_token);
      }

      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  async googleLogin(token: string): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_URL}/api/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });

      const data: AuthResponse = await response.json();

      if (data.success && data.access_token && data.refresh_token) {
        this.setTokens(data.access_token, data.refresh_token);
      }

      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  async logout(): Promise<void> {
    const token = this.getToken();

    if (token) {
      try {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        // Ignore errors on logout
        console.error("Logout error:", error);
      }
    }

    this.clearTokens();
  }

  async getCurrentUser(): Promise<User | null> {
    const token = this.getToken();

    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await this.refreshToken();
        if (refreshed) {
          return this.getCurrentUser(); // Retry with new token
        }
        return null;
      }

      // Handle 422 - invalid token format (e.g., old tokens with integer identity)
      if (response.status === 422) {
        this.clearTokens();
        return null;
      }

      const data = await response.json();
      return data.success ? data.user : null;
    } catch (error) {
      console.error("Get current user error:", error);
      return null;
    }
  }

  async refreshToken(): Promise<boolean> {
    const refreshToken = this.getRefreshToken();

    if (!refreshToken) {
      return false;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
      });

      // Handle errors - clear tokens for 422, 500, or other failures
      if (response.status === 422 || response.status === 500 || !response.ok) {
        console.warn("Invalid or expired refresh token, clearing tokens");
        this.clearTokens();
        return false;
      }

      const data: AuthResponse = await response.json();

      if (data.success && data.access_token) {
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

      const result: AuthResponse = await response.json();
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }
}

export const authService = new AuthService();
