import { useState } from "react";
import { useAuth } from "@/features/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import GoogleLoginButton from "./GoogleLoginButton";

interface RegisterFormProps {
  onSwitchToLogin?: () => void;
}

export default function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    if (!hasUpperCase || !hasNumber) {
      setError(
        "Password must contain at least one uppercase letter and one number"
      );
      return;
    }

    setLoading(true);

    try {
      const result = await register({ name, email, password });

      if (!result.success) {
        setError(result.error || "Registration failed");
      }
      // On success, the AuthContext will update and redirect will happen via routing
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md">
      <CardHeader className="space-y-3 pb-8">
        <CardTitle className="text-white text-4xl">Create Account</CardTitle>
        <div className="h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
        <CardDescription className="text-white/80 text-lg">
          Sign up to start creating presentations with AI
        </CardDescription>
      </CardHeader>
      <CardContent className="px-8 pb-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <Alert
              variant="destructive"
              className="bg-red-500/20 border-red-500/50 text-white"
            >
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <GoogleLoginButton
            onError={(err) => setError(err)}
            onSuccess={() => {
              // Redirect handled by AuthContext
            }}
          />

          <div className="flex justify-center text-sm">
            <span className="text-white/60">Or continue with email</span>
          </div>

          <div className="space-y-3">
            <Label htmlFor="name" className="text-white/80 text-lg">
              Name
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
            />
          </div>

          <div className="space-y-3">
            <Label htmlFor="email" className="text-white/80 text-lg">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
            />
          </div>

          <div className="space-y-3">
            <Label htmlFor="password" className="text-white/80 text-lg">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              minLength={8}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
            />
            {password && (
              <p className="text-sm text-white/60">
                Password must be at least 8 characters long and contain at least
                one uppercase letter and one number
              </p>
            )}
          </div>

          <div className="space-y-3">
            <Label htmlFor="confirmPassword" className="text-white/80 text-lg">
              Confirm Password
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading}
              minLength={8}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
            />
          </div>

          <div className="flex justify-center my-8">
            <Button
              type="submit"
              className="w-1/3 bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-14 text-lg font-semibold"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Sign Up"
              )}
            </Button>
          </div>

          {onSwitchToLogin && (
            <div className="text-center text-sm text-white/60">
              Already have an account?{" "}
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="text-white hover:underline font-medium"
                disabled={loading}
              >
                Sign in
              </button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
