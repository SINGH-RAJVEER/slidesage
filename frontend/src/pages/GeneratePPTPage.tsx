import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sparkles, ArrowLeft, ChevronDown } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authService } from "@/services/authService";
import Header from "@/components/Header";

const API_URL = import.meta.env.VITE_API_URL;

export default function GeneratePPTPage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasPresentations, setHasPresentations] = useState(false);
  const [slideCount, setSlideCount] = useState("5-10");
  const [detailLevel, setDetailLevel] = useState("balanced");
  const [tonality, setTonality] = useState("professional");
  const navigate = useNavigate();
  const location = useLocation();

  // Check if we came from the grid page (via /generate route) and user has presentations
  const showBackButton = location.pathname === "/generate" && hasPresentations;

  useEffect(() => {
    checkPresentations();
  }, []);

  const checkPresentations = async () => {
    try {
      const headers = authService.getAuthHeaders();
      const response = await fetch(`${API_URL}/api/presentations`, {
        headers,
      });

      if (response.status === 401) {
        const refreshed = await authService.refreshToken();
        if (refreshed) {
          const newHeaders = authService.getAuthHeaders();
          const retryResponse = await fetch(`${API_URL}/api/presentations`, {
            headers: newHeaders,
          });

          if (retryResponse.ok) {
            const retryResult = await retryResponse.json();
            setHasPresentations(
              retryResult.success && retryResult.presentations.length > 0
            );
          }
        }
        return;
      }

      const result = await response.json();
      setHasPresentations(result.success && result.presentations.length > 0);
    } catch (err) {
      console.error("Error checking presentations:", err);
    }
  };

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
        <div className="w-full max-w-4xl relative">
          {showBackButton && (
            <div className="mb-4 flex items-center justify-between bg-white/10 backdrop-blur-md rounded-2xl px-6 py-3 border border-white/20">
              <Button
                onClick={() => navigate("/")}
                variant="outline"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
              </Button>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-white/70 text-sm">Detail Level:</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-36 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
                      >
                        {detailLevel.charAt(0).toUpperCase() +
                          detailLevel.slice(1)}
                        <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-36 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
                      <DropdownMenuItem
                        onClick={() => setDetailLevel("brief")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Brief
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDetailLevel("concise")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Concise
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDetailLevel("balanced")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Balanced
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDetailLevel("detailed")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Detailed
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDetailLevel("comprehensive")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Comprehensive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/70 text-sm">Tonality:</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-36 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
                      >
                        {tonality.charAt(0).toUpperCase() + tonality.slice(1)}
                        <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-36 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
                      <DropdownMenuItem
                        onClick={() => setTonality("professional")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Professional
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTonality("casual")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Casual
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTonality("formal")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Formal
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTonality("balanced")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Balanced
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTonality("friendly")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Friendly
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTonality("enthusiastic")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Enthusiastic
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setTonality("persuasive")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        Persuasive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/70 text-sm">Slides:</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-28 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
                      >
                        {slideCount}
                        <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-28 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
                      <DropdownMenuItem
                        onClick={() => setSlideCount("3-5")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        3-5
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSlideCount("5-10")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        5-10
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSlideCount("10-15")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        10-15
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSlideCount("15-20")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        15-20
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSlideCount("20+")}
                        className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                      >
                        20+
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          )}
          <Card className="shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md">
            <CardHeader className="space-y-3 pb-8">
              <CardTitle className="flex items-center gap-2 text-white text-4xl">
                <Sparkles className="h-6 w-6" />
                Generate a Presentation
              </CardTitle>
              <div className="h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
            </CardHeader>
            <CardContent className="px-8 pb-8 space-y-6">
              <div className="space-y-3">
                <label
                  htmlFor="prompt"
                  className="block text-lg font-medium text-white/80"
                >
                  Presentation Topic
                </label>
                <Textarea
                  id="prompt"
                  placeholder="List your topics"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[200px] text-xl bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
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
                    "Generate Presentation"
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
    </div>
  );
}
