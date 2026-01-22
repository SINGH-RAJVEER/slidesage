import { authClient } from "../../../lib/auth-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export type User = {
  id: string;
  email: string;
  name: string;
  image?: string;
  profile_picture?: string;
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
  current_password?: string;
  new_password?: string;
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
        user: (data?.user as unknown) as User,
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
        user: (data?.user as unknown) as User,
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
      return (data?.user as unknown) as User | null;
    } catch (error) {
      return null;
    }
  }

  async googleLogin(credential: string): Promise<AuthResponse> {
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
      const response = await fetch(`${API_URL}/api/auth/profile`, {
        method: "PUT",
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
          error: typeof result.error === "object" ? result.error.message : result.error,
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