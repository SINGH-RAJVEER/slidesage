import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import type { Slide, PresentationData } from "@/types/presentation";
import { authService } from "@/services/authService";

const API_URL = import.meta.env.VITE_API_URL;

interface StreamingState {
  isStreaming: boolean;
  slides: Slide[];
  theme: string;
  title: string;
  totalSlides: number;
  presentationId?: number;
  error?: string;
  isComplete: boolean;
}

interface StreamingContextValue {
  streamingState: StreamingState;
  startStreaming: (
    prompt: string,
    slideCount: number,
    detailLevel: string,
    tonality: string
  ) => Promise<boolean>;
  startIterating: (
    prompt: string,
    parentPresentationId: number,
    slideCount: number,
    detailLevel: string,
    tonality: string
  ) => Promise<boolean>;
  stopStreaming: () => void;
  resetStreaming: () => void;
  getPresentation: () => PresentationData | null;
}

const initialState: StreamingState = {
  isStreaming: false,
  slides: [],
  theme: "default",
  title: "Untitled Presentation",
  totalSlides: 0,
  isComplete: false,
};

const StreamingContext = createContext<StreamingContextValue | null>(null);

export function StreamingProvider({ children }: { children: React.ReactNode }) {
  const [streamingState, setStreamingState] =
    useState<StreamingState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null
  );

  const resetStreaming = useCallback(() => {
    setStreamingState(initialState);
  }, []);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (readerRef.current) {
      readerRef.current.cancel();
      readerRef.current = null;
    }
    setStreamingState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  const getPresentation = useCallback((): PresentationData | null => {
    if (streamingState.slides.length === 0) return null;
    return {
      title: streamingState.title,
      theme: streamingState.theme,
      slides: streamingState.slides,
      totalSlides: streamingState.slides.length,
    };
  }, [streamingState]);

  const startStreaming = useCallback(
    async (
      prompt: string,
      slideCount: number,
      detailLevel: string,
      tonality: string
    ): Promise<boolean> => {
      // Reset state
      setStreamingState({
        ...initialState,
        isStreaming: true,
      });

      abortControllerRef.current = new AbortController();

      try {
        const headers = authService.getAuthHeaders();
        let response = await fetch(
          `${API_URL}/api/generate-presentation-stream`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              prompt,
              slideCount,
              detailLevel,
              tonality,
            }),
            signal: abortControllerRef.current.signal,
          }
        );

        // Handle 401 Unauthorized - token might be expired
        if (response.status === 401) {
          const refreshed = await authService.refreshToken();
          if (refreshed) {
            const newHeaders = authService.getAuthHeaders();
            response = await fetch(
              `${API_URL}/api/generate-presentation-stream`,
              {
                method: "POST",
                headers: newHeaders,
                body: JSON.stringify({
                  prompt,
                  slideCount,
                  detailLevel,
                  tonality,
                }),
                signal: abortControllerRef.current.signal,
              }
            );
          } else {
            setStreamingState((prev) => ({
              ...prev,
              isStreaming: false,
              error: "Session expired. Please log in again.",
            }));
            return false;
          }
        }

        if (response.status === 422) {
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: "Your session is invalid. Please log out and log in again.",
          }));
          return false;
        }

        if (!response.ok) {
          const errorData = await response.json();
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: errorData.error || "Failed to generate presentation",
          }));
          return false;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: "Failed to read streaming response",
          }));
          return false;
        }

        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = ""; // Persist across reads

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (line.startsWith("event: ")) {
                  currentEvent = line.slice(7).trim();
                } else if (line.startsWith("data: ") && currentEvent) {
                  const dataStr = line.slice(6);
                  try {
                    const data = JSON.parse(dataStr);

                    switch (currentEvent) {
                      case "start":
                        // Generation started
                        break;

                      case "theme":
                        setStreamingState((prev) => ({
                          ...prev,
                          theme: data.theme,
                        }));
                        break;

                      case "slide":
                        setStreamingState((prev) => {
                          const newSlides = [...prev.slides, data.slide];
                          console.log(
                            "Adding slide",
                            data.slide.id,
                            "Total slides:",
                            newSlides.length
                          );
                          return {
                            ...prev,
                            slides: newSlides,
                            title: data.title || prev.title,
                            totalSlides: newSlides.length,
                          };
                        });
                        break;

                      case "complete":
                        setStreamingState((prev) => ({
                          ...prev,
                          isComplete: true,
                          theme: data.theme || prev.theme,
                          title: data.title || prev.title,
                          totalSlides: data.totalSlides || prev.slides.length,
                        }));
                        break;

                      case "saved":
                        setStreamingState((prev) => ({
                          ...prev,
                          presentationId: data.presentation_id,
                        }));
                        break;

                      case "error":
                        setStreamingState((prev) => ({
                          ...prev,
                          isStreaming: false,
                          error: data.error,
                        }));
                        return;
                    }

                    // Reset event after processing
                    currentEvent = "";
                  } catch (parseErr) {
                    console.error("Failed to parse SSE data:", parseErr);
                  }
                }
              }
            }

            // Stream complete
            setStreamingState((prev) => ({
              ...prev,
              isStreaming: false,
              isComplete: true,
            }));
          } catch (streamErr: any) {
            if (streamErr.name !== "AbortError") {
              console.error("Stream error:", streamErr);
              setStreamingState((prev) => ({
                ...prev,
                isStreaming: false,
                error: `Streaming error: ${streamErr.message || streamErr}`,
              }));
            }
          }
        };

        // Start processing the stream in the background
        processStream();
        return true;
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: `Error: ${err.message || err}`,
          }));
        }
        return false;
      }
    },
    []
  );

  const startIterating = useCallback(
    async (
      prompt: string,
      parentPresentationId: number,
      slideCount: number,
      detailLevel: string,
      tonality: string
    ): Promise<boolean> => {
      // Reset state
      setStreamingState({
        ...initialState,
        isStreaming: true,
      });

      abortControllerRef.current = new AbortController();

      try {
        const headers = authService.getAuthHeaders();
        let response = await fetch(
          `${API_URL}/api/iterate-presentation-stream`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              prompt,
              parentPresentationId,
              slideCount,
              detailLevel,
              tonality,
            }),
            signal: abortControllerRef.current.signal,
          }
        );

        // Handle 401 Unauthorized - token might be expired
        if (response.status === 401) {
          const refreshed = await authService.refreshToken();
          if (refreshed) {
            const newHeaders = authService.getAuthHeaders();
            response = await fetch(
              `${API_URL}/api/iterate-presentation-stream`,
              {
                method: "POST",
                headers: newHeaders,
                body: JSON.stringify({
                  prompt,
                  parentPresentationId,
                  slideCount,
                  detailLevel,
                  tonality,
                }),
                signal: abortControllerRef.current.signal,
              }
            );
          } else {
            setStreamingState((prev) => ({
              ...prev,
              isStreaming: false,
              error: "Session expired. Please log in again.",
            }));
            return false;
          }
        }

        if (response.status === 422) {
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: "Your session is invalid. Please log out and log in again.",
          }));
          return false;
        }

        if (!response.ok) {
          const errorData = await response.json();
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: errorData.error || "Failed to iterate presentation",
          }));
          return false;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: "Failed to read streaming response",
          }));
          return false;
        }

        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = ""; // Persist across reads

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (line.startsWith("event: ")) {
                  currentEvent = line.slice(7).trim();
                } else if (line.startsWith("data: ") && currentEvent) {
                  const dataStr = line.slice(6);
                  try {
                    const data = JSON.parse(dataStr);

                    switch (currentEvent) {
                      case "start":
                        // Generation started
                        break;

                      case "theme":
                        setStreamingState((prev) => ({
                          ...prev,
                          theme: data.theme,
                        }));
                        break;

                      case "slide":
                        setStreamingState((prev) => {
                          const newSlides = [...prev.slides, data.slide];
                          console.log(
                            "Adding slide",
                            data.slide.id,
                            "Total slides:",
                            newSlides.length
                          );
                          return {
                            ...prev,
                            slides: newSlides,
                            title: data.title || prev.title,
                            totalSlides: newSlides.length,
                          };
                        });
                        break;

                      case "complete":
                        setStreamingState((prev) => ({
                          ...prev,
                          isComplete: true,
                          theme: data.theme || prev.theme,
                          title: data.title || prev.title,
                          totalSlides: data.totalSlides || prev.slides.length,
                        }));
                        break;

                      case "saved":
                        setStreamingState((prev) => ({
                          ...prev,
                          presentationId: data.presentation_id,
                        }));
                        break;

                      case "error":
                        setStreamingState((prev) => ({
                          ...prev,
                          isStreaming: false,
                          error: data.error,
                        }));
                        return;
                    }

                    // Reset event after processing
                    currentEvent = "";
                  } catch (parseErr) {
                    console.error("Failed to parse SSE data:", parseErr);
                  }
                }
              }
            }

            // Stream complete
            setStreamingState((prev) => ({
              ...prev,
              isStreaming: false,
              isComplete: true,
            }));
          } catch (streamErr: any) {
            if (streamErr.name !== "AbortError") {
              console.error("Stream error:", streamErr);
              setStreamingState((prev) => ({
                ...prev,
                isStreaming: false,
                error: `Streaming error: ${streamErr.message || streamErr}`,
              }));
            }
          }
        };

        // Start processing the stream in the background
        processStream();
        return true;
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: `Error: ${err.message || err}`,
          }));
        }
        return false;
      }
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  return (
    <StreamingContext.Provider
      value={{
        streamingState,
        startStreaming,
        startIterating,
        stopStreaming,
        resetStreaming,
        getPresentation,
      }}
    >
      {children}
    </StreamingContext.Provider>
  );
}

export function useStreaming() {
  const context = useContext(StreamingContext);
  if (!context) {
    throw new Error("useStreaming must be used within a StreamingProvider");
  }
  return context;
}
