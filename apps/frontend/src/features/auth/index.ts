// Auth feature exports
export { AuthProvider, useAuth } from "./contexts/AuthContext";
export { authService } from "./services/authService";
export { default as LoginPage } from "./pages/LoginPage";
export { default as ProtectedRoute } from "./components/ProtectedRoute";

// Types
export type {
  User,
  AuthResponse,
  LoginCredentials,
  RegisterCredentials,
  UpdateProfileData,
} from "./services/authService";
