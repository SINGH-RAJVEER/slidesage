import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import Header from "@/components/Header";
import { useEffect } from "react";

function sanitizeRedirectPath(value: string | null) {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

export default function SignUpPage() {
  const [searchParams] = useSearchParams();
  const redirectTo = sanitizeRedirectPath(searchParams.get("redirect_url"));
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();

  // Redirect to dashboard if already signed in
  useEffect(() => {
    if (isSignedIn) {
      navigate("/");
    }
  }, [isSignedIn, navigate]);

  const handleGoogleSignUp = () => {
    const callbackUrl = encodeURIComponent(window.location.origin + redirectTo);
    window.location.href = `/api/auth/callback/google?callbackURL=${callbackUrl}`;
  };

  const handleGithubSignUp = () => {
    const callbackUrl = encodeURIComponent(window.location.origin + redirectTo);
    window.location.href = `/api/auth/callback/github?callbackURL=${callbackUrl}`;
  };

  return (
    <div className="min-h-screen bg-transparent flex flex-col">
      <Header />
      <div className="flex-1 flex items-center justify-center px-4 md:px-8">
        <div className="max-w-md w-full">
          <div className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-8 shadow-2xl">
            <h1 className="text-3xl font-bold text-white mb-2">Get Started</h1>
            <p className="text-white/60 mb-8">Create your Slide Sage account</p>

            <div className="space-y-4">
              <button
                onClick={handleGoogleSignUp}
                className="w-full bg-white hover:bg-white/90 text-black font-semibold py-3 px-4 rounded-lg transition duration-200 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Sign up with Google
              </button>

              <button
                onClick={handleGithubSignUp}
                className="w-full bg-[#1F2937] hover:bg-[#111827] text-white font-semibold py-3 px-4 rounded-lg transition duration-200 flex items-center justify-center gap-2 border border-white/10"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.868-.013-1.703-2.782.603-3.369-1.343-3.369-1.343-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.545 2.914 1.209.092-.937.35-1.546.636-1.903-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.025A9.578 9.578 0 0110 4.836c.85.004 1.705.114 2.504.336 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.578.688.48C17.137 18.194 20 14.44 20 10.017 20 4.484 15.522 0 10 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Sign up with GitHub
              </button>
            </div>

            <p className="text-center text-white/50 text-sm mt-8">
              Already have an account?{" "}
              <a
                href="/sign-in"
                className="text-white hover:underline font-semibold"
              >
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
