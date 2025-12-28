import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { authService } from "@/services/authService";
import Header from "@/components/Header";

const API_URL = import.meta.env.VITE_API_URL;

export default function GeneratePPTPage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError("");

    try {
      const headers = authService.getAuthHeaders();
      const presentationResponse = await fetch(
        `${API_URL}/api/generate-presentation`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt: prompt.trim() }),
        }
      );

      // Handle 401 Unauthorized - token might be expired
      if (presentationResponse.status === 401) {
        const refreshed = await authService.refreshToken();
        if (refreshed) {
          // Retry with new token
          const newHeaders = authService.getAuthHeaders();
          const retryResponse = await fetch(
            `${API_URL}/api/generate-presentation`,
            {
              method: "POST",
              headers: newHeaders,
              body: JSON.stringify({ prompt: prompt.trim() }),
            }
          );

          if (!retryResponse.ok) {
            setError("Authentication failed. Please log in again.");
            return;
          }

          const retryResult = await retryResponse.json();
          if (!retryResult.success) {
            setError(retryResult.error || "Failed to generate presentation");
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
          navigate("/presentation", {
            state: { presentation: retryResult.data },
          });
          return;
        } else {
          setError("Session expired. Please log in again.");
          return;
        }
      }

      // Handle 422 - invalid token format (e.g., old tokens with integer identity)
      if (presentationResponse.status === 422) {
        setError("Your session is invalid. Please log out and log in again.");
        return;
      }

      const presentationResult = await presentationResponse.json();

      if (!presentationResult.success) {
        setError(presentationResult.error || "Failed to generate presentation");
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      navigate("/presentation", {
        state: { presentation: presentationResult.data },
      });
    } catch (err) {
      setError(`Error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Header />
      <div className="p-4 md:p-8 flex items-center justify-center min-h-[calc(100vh-64px)]">
        <Card className="w-full max-w-2xl shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Sparkles className="h-5 w-5" />
              Generate a Presentation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label
                htmlFor="prompt"
                className="block text-sm font-medium text-white/80"
              >
                Presentation Topic
              </label>
              <Textarea
                id="prompt"
                placeholder="List your topics"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[120px] text-base bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                disabled={loading}
              />
            </div>

            <div className="flex justify-center my-8">
              <Button
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
                className="w-1/3 bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-14 text-lg font-semibold"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Generating
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Generate Presentation
                  </>
                )}
              </Button>
            </div>
            {error && (
              <Alert
                variant="destructive"
                className="bg-red-500/20 border-red-500/50 text-white"
              >
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
