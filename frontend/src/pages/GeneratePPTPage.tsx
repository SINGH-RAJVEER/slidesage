import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sparkles, ArrowLeft, ChevronDown, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authService } from "@/services/authService";
import Header from "@/components/Header";
import { useStreaming } from "@/contexts/StreamingContext";

const API_URL = import.meta.env.VITE_API_URL;

export default function GeneratePPTPage() {
  const [prompt, setPrompt] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasPresentations, setHasPresentations] = useState(false);
  const [slideCount, setSlideCount] = useState("5");
  const [slideCountMode, setSlideCountMode] = useState("preset");
  const [customSlideCount, setCustomSlideCount] = useState("5");
  const [detailLevel, setDetailLevel] = useState("balanced");
  const [tonality, setTonality] = useState("professional");
  const navigate = useNavigate();
  const location = useLocation();
  const { streamingState, startStreaming, resetStreaming } = useStreaming();

  // Check if we came from the grid page (via /generate route) and user has presentations
  const showBackButton = location.pathname === "/generate" && hasPresentations;

  useEffect(() => {
    checkPresentations();
    // Reset streaming state when entering generate page
    resetStreaming();
  }, []);

  // Navigate to viewer when first slide arrives
  useEffect(() => {
    if (streamingState.slides.length >= 1 && loading) {
      setLoading(false);
      navigate("/presentation", {
        state: {
          isStreaming: true,
        },
      });
    }
  }, [streamingState.slides.length, loading, navigate]);

  // Handle streaming errors
  useEffect(() => {
    if (streamingState.error) {
      setError(streamingState.error);
      setLoading(false);
    }
  }, [streamingState.error]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && prompt.trim()) {
      e.preventDefault();
      if (!topics.includes(prompt.trim())) {
        setTopics([...topics, prompt.trim()]);
      }
      setPrompt("");
    }
  };

  const handleRemoveTopic = (topicToRemove: string) => {
    setTopics(topics.filter((topic) => topic !== topicToRemove));
  };

  const handleGenerate = async () => {
    if (topics.length === 0) return;

    setLoading(true);
    setError("");

    // Get the slide count (either from preset or custom)
    const count =
      slideCountMode === "preset"
        ? parseInt(slideCount)
        : parseInt(customSlideCount);

    const success = await startStreaming(
      topics.join(", "),
      count,
      detailLevel,
      tonality
    );

    if (!success) {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col">
      <Header />
      <div className="flex-1 p-4 md:p-8 flex items-center justify-center overflow-y-auto">
        <div className="w-full max-w-4xl relative">
          {showBackButton && (
            <div className="absolute bottom-[calc(100%+1rem)] left-0 right-0 flex items-center justify-between bg-white/10 backdrop-blur-md rounded-2xl px-6 py-3 border border-white/20">
              <Button
                onClick={() => navigate("/")}
                variant="outline"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-white/70 text-sm">Detail Level:</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="min-w-36 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
                      >
                        {detailLevel.charAt(0).toUpperCase() +
                          detailLevel.slice(1)}
                        <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-36 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
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
                  {slideCountMode === "preset" ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-24 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
                        >
                          {slideCount}
                          <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-24 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
                        <DropdownMenuItem
                          onClick={() => {
                            setSlideCount("5");
                            setCustomSlideCount("5");
                            setSlideCountMode("preset");
                          }}
                          className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                        >
                          5
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSlideCount("10");
                            setCustomSlideCount("10");
                            setSlideCountMode("preset");
                          }}
                          className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                        >
                          10
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSlideCount("15");
                            setCustomSlideCount("15");
                            setSlideCountMode("preset");
                          }}
                          className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                        >
                          15
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSlideCount("20");
                            setCustomSlideCount("20");
                            setSlideCountMode("preset");
                          }}
                          className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                        >
                          20
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSlideCount("25");
                            setCustomSlideCount("25");
                            setSlideCountMode("preset");
                          }}
                          className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                        >
                          25
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSlideCount("30");
                            setCustomSlideCount("30");
                            setSlideCountMode("preset");
                          }}
                          className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                        >
                          30
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setSlideCountMode("custom")}
                          className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
                        >
                          Custom
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      max={35}
                      value={customSlideCount}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (/^\d{0,2}$/.test(val) && Number(val) <= 35) {
                          setCustomSlideCount(val);
                        }
                      }}
                      onBlur={() => {
                        let val = Number(customSlideCount);
                        if (isNaN(val) || val < 1) val = 1;
                        if (val > 35) val = 35;
                        setCustomSlideCount(val.toString());
                        setSlideCount(val.toString());
                        setSlideCountMode("preset");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          let val = Number(customSlideCount);
                          if (isNaN(val) || val < 1) val = 1;
                          if (val > 35) val = 35;
                          setCustomSlideCount(val.toString());
                          setSlideCount(val.toString());
                          setSlideCountMode("preset");
                        } else if (e.key === "Escape") {
                          setSlideCountMode("preset");
                        }
                      }}
                      className="w-24 px-3 py-2 rounded-md border border-white/20 bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-400 hide-number-spin"
                      placeholder="1-35"
                      inputMode="numeric"
                      style={{ MozAppearance: "textfield" }}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
          <Card className="shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md">
            <CardHeader className="space-y-3 pb-8">
              <CardTitle className="flex items-center gap-2 text-white text-4xl">
                Generate Presentation
              </CardTitle>
              <div className="h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
            </CardHeader>
            <CardContent className="px-8 pb-8 space-y-6">
              <div className="space-y-3">
                <label
                  htmlFor="prompt"
                  className="block text-lg font-medium text-white/80"
                >
                  Presentation Topics
                </label>
                {topics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-2 bg-white/5 rounded-lg border border-white/10">
                    {topics.map((topic, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-white/20 border border-white/30 rounded-full text-white text-sm backdrop-blur-sm hover:bg-white/25 transition-all duration-200"
                      >
                        <span className="font-medium">{topic}</span>
                        <button
                          onClick={() => handleRemoveTopic(topic)}
                          className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
                          disabled={loading}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Input
                  id="prompt"
                  placeholder="Type a topic and press Enter"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="text-xl bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-14"
                  disabled={loading}
                />
              </div>

              <div className="flex justify-center my-8">
                <Button
                  onClick={handleGenerate}
                  disabled={loading || topics.length === 0}
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
