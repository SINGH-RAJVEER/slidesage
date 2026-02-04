import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ChartRenderer from "@/components/presentations/Charts/ChartRenderer";
import DownloadPPTXButton from "@/components/presentations/Viewer/DownloadPPTXButton";
import IterateModal from "@/components/presentations/Viewer/IterateModal";
import TemplateApplier from "@/components/presentations/Viewer/TemplateApplier";
import TemplateSelector from "@/components/presentations/Viewer/TemplateSelector";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useStreaming } from "@/modules/presentations";
import type {
  ChartSlide,
  HtmlSlide,
  PresentationData,
  Slide,
} from "@/modules/types/presentation";
import { AVAILABLE_TEMPLATES } from "@/modules/types/template";
import { useTemplate } from "@/modules/useTemplate";
import { ROUTES } from "@/router/paths";

const API_URL = import.meta.env.VITE_API_URL;

const SlideRenderer = React.memo(
  ({
    slide,
    currentTemplate,
    isActive,
  }: {
    slide: Slide;
    currentTemplate: string;
    isActive: boolean;
  }) => {
    const template = AVAILABLE_TEMPLATES.find((t) => t.id === currentTemplate);
    const textColor = template?.styles.slideContent.color || "white";

    if (slide.type === "chart") {
      const chartSlide = slide as ChartSlide;
      return (
        <TemplateApplier
          templateId={currentTemplate}
          className="w-full h-full"
          slideType="chart"
        >
          <div
            id="slide-content"
            className="w-full h-full flex items-center justify-center"
          >
            <ChartRenderer
              chartConfig={chartSlide.chartConfig}
              className="w-full h-full"
              textColor={textColor}
              isActive={isActive}
            />
          </div>
        </TemplateApplier>
      );
    } else {
      const htmlSlide = slide as HtmlSlide;
      return (
        <TemplateApplier
          templateId={currentTemplate}
          className="w-full h-full"
          slideType={htmlSlide.type}
        >
          <div
            className="w-full h-full flex flex-col justify-center"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Rendering user content from html slide
            dangerouslySetInnerHTML={{
              __html: htmlSlide.html,
            }}
          />
        </TemplateApplier>
      );
    }
  },
  (prevProps, nextProps) => {
    if (prevProps.currentTemplate !== nextProps.currentTemplate) return false;
    if (prevProps.slide !== nextProps.slide) return false;
    if (prevProps.slide.type === "chart") {
      return prevProps.isActive === nextProps.isActive;
    }
    return true; // Ignore isActive changes for HTML slides
  },
);

const PresentationViewer: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const { streamingState, getPresentation, startIterating } = useStreaming();

  const presentationIdFromParams = (() => {
    const raw = params.presentationId;
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  })();

  const isStreamingMode = location.state?.isStreaming === true;

  const getInitialPresentation = (): PresentationData | undefined => {
    if (isStreamingMode) {
      return getPresentation() || undefined;
    }
    if (location.state?.presentation) {
      return location.state?.presentation;
    }
    if (location.state?.isNewGeneration) {
      return location.state?.presentation;
    }
    return undefined;
  };

  const [presentationState, setPresentation] = useState<
    PresentationData | undefined
  >(getInitialPresentation());
  const [presentationId, setPresentationId] = useState<number | undefined>(
    presentationIdFromParams ||
      location.state?.presentationId ||
      streamingState.presentationId,
  );
  const [isLoadingPresentation, setIsLoadingPresentation] = useState(
    !isStreamingMode &&
      !location.state?.presentation &&
      !location.state?.isNewGeneration &&
      !!(presentationIdFromParams || location.state?.presentationId),
  );
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [slideInterval, setSlideInterval] = useState(5);
  const [intervalMode, setIntervalMode] = useState("preset");
  const [customInterval, setCustomInterval] = useState("5");
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const slideContainerRef = useRef<HTMLDivElement | null>(null);
  const [visibleSlide, setVisibleSlide] = useState(0);
  const thumbnailScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [showIterateModal, setShowIterateModal] = useState(false);

  const { currentTemplate, changeTemplate } = useTemplate();

  const streamingSlidesCount = streamingState.slides.length;

  useEffect(() => {
    if (
      presentationIdFromParams &&
      presentationIdFromParams !== presentationId
    ) {
      setPresentationId(presentationIdFromParams);
    }
  }, [presentationIdFromParams, presentationId]);

  useEffect(() => {
    if (streamingState.isStreaming && streamingSlidesCount === 0) {
      setPresentation(undefined);
    }
  }, [streamingState.isStreaming, streamingSlidesCount]);

  // Update presentation while streaming
  useEffect(() => {
    if (streamingSlidesCount > 0 && streamingState.isStreaming) {
      setPresentation({
        title: streamingState.title,
        theme: streamingState.theme,
        slides: streamingState.slides.map((s) => ({ ...s })),
        totalSlides: streamingSlidesCount,
      });
    }
  }, [
    streamingSlidesCount,
    streamingState.isStreaming,
    streamingState.title,
    streamingState.theme,
    streamingState.slides,
  ]);

  // CRITICAL: Capture final presentation state when streaming completes
  // This ensures we have the complete data even if the DB hasn't fully saved yet
  useEffect(() => {
    if (
      streamingState.isComplete &&
      !streamingState.isStreaming &&
      streamingState.slides.length > 0
    ) {
      console.log(
        "Streaming completed - capturing final presentation state with",
        streamingState.slides.length,
        "slides",
      );
      setPresentation({
        title: streamingState.title,
        theme: streamingState.theme,
        slides: streamingState.slides.map((s) => ({ ...s })),
        totalSlides: streamingState.slides.length,
      });
    }
  }, [
    streamingState.isComplete,
    streamingState.isStreaming,
    streamingState.slides,
    streamingState.title,
    streamingState.theme,
  ]);

  useEffect(() => {
    if (streamingState.isStreaming && streamingSlidesCount > 0) {
      const latestSlideIndex = streamingSlidesCount - 1;
      setCurrentSlide(latestSlideIndex);

      setTimeout(() => {
        const slideElement = document.getElementById(
          `slide-${latestSlideIndex}`,
        );
        if (slideElement) {
          slideElement.scrollIntoView({
            behavior: "smooth",
            inline: "center",
            block: "nearest",
          });
        }
      }, 100);
    }
  }, [streamingState.isStreaming, streamingSlidesCount]);

  // Reset to first slide when streaming completes
  useEffect(() => {
    if (
      streamingState.isComplete &&
      !streamingState.isStreaming &&
      streamingSlidesCount > 0
    ) {
      setCurrentSlide(0);
      setTimeout(() => {
        const slideElement = document.getElementById("slide-0");
        if (slideElement) {
          slideElement.scrollIntoView({
            behavior: "smooth",
            inline: "center",
            block: "nearest",
          });
        }
      }, 100);
    }
  }, [
    streamingState.isComplete,
    streamingState.isStreaming,
    streamingSlidesCount,
  ]);

  useEffect(() => {
    if (streamingState.presentationId && !presentationId) {
      setPresentationId(streamingState.presentationId);
    }
  }, [streamingState.presentationId, presentationId]);

  // Track if streaming just completed - use this to skip immediate fetch after streaming
  const streamingJustCompletedRef = useRef(false);
  const wasStreamingRef = useRef(streamingState.isStreaming);

  useEffect(() => {
    // Detect when streaming transitions from true to false
    if (
      wasStreamingRef.current &&
      !streamingState.isStreaming &&
      streamingState.isComplete
    ) {
      streamingJustCompletedRef.current = true;
      console.log(
        "Streaming just completed, will skip fetch and use streamed data",
      );
    }
    wasStreamingRef.current = streamingState.isStreaming;
  }, [streamingState.isStreaming, streamingState.isComplete]);

  const lastFetchedPresentationIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const fetchPresentation = async () => {
      const idToFetch =
        presentationIdFromParams ||
        presentationId ||
        location.state?.presentationId;

      // Don't fetch if actively streaming
      if (streamingState.isStreaming) {
        setIsLoadingPresentation(false);
        return;
      }

      // If streaming just completed and we have presentation data, don't fetch
      // This prevents race conditions with distributed deployments where DB might not have committed yet
      if (
        streamingJustCompletedRef.current &&
        presentationState &&
        presentationState.slides.length > 0
      ) {
        console.log("Skipping fetch - using data from completed stream");
        setIsLoadingPresentation(false);
        streamingJustCompletedRef.current = false; // Reset for next time
        return;
      }

      // If streaming is complete and we have valid slides in streaming state, use those
      if (streamingState.isComplete && streamingState.slides.length > 0) {
        console.log("Skipping fetch - streaming complete with valid data");
        setIsLoadingPresentation(false);
        return;
      }

      if (!idToFetch) {
        setIsLoadingPresentation(false);
        return;
      }

      // If navigation provided presentation data for this id, prefer it
      if (
        location.state?.presentation &&
        location.state?.presentationId === idToFetch &&
        presentationState &&
        presentationState.slides.length > 0
      ) {
        setIsLoadingPresentation(false);
        return;
      }

      // If we're in streaming mode and have valid data, don't refetch
      if (
        isStreamingMode &&
        presentationState &&
        presentationState.slides.length > 0
      ) {
        setIsLoadingPresentation(false);
        return;
      }

      if (lastFetchedPresentationIdRef.current === idToFetch) {
        return;
      }

      lastFetchedPresentationIdRef.current = idToFetch;
      setIsLoadingPresentation(true);

      try {
        const response = await fetch(
          `${API_URL}/api/presentations/${idToFetch}`,
          {
            credentials: "include",
          },
        );

        if (response.ok) {
          const data = await response.json();
          // New API format: {presentation: {...}} or {error: {message: "..."}}
          if (data.error) {
            console.error(
              "Error loading presentation:",
              data.error.message || data.error,
            );
          } else if (data.presentation) {
            const pres = data.presentation;
            // Handle both slides and slides_data fields
            const slidesData = pres.slides || pres.slides_data || {};
            const fetchedSlides = slidesData.slides || [];

            // Only update if fetched data has valid slides
            // This prevents overwriting good data with placeholder/empty data
            if (fetchedSlides.length > 0 && pres.title !== "Generating...") {
              setPresentation({
                title: pres.title || slidesData.title,
                theme: slidesData.theme || "default",
                slides: fetchedSlides,
                totalSlides:
                  slidesData.totalSlides || fetchedSlides.length || 0,
              });
              setPresentationId(pres.id);
              console.log("Loaded fresh presentation data from API");
            } else if (
              pres.title === "Generating..." ||
              fetchedSlides.length === 0
            ) {
              // Presentation has no content - redirect to error page
              console.log(
                "Presentation has no content, redirecting to error page",
              );
              navigate(ROUTES.presentationError, {
                state: {
                  presentationId: pres.id,
                  error: "This presentation failed to generate content.",
                },
              });
            } else {
              console.log(
                "Fetched data appears incomplete, keeping current state",
              );
            }
          }
        }
      } catch (error) {
        console.error("Error fetching presentation:", error);
      } finally {
        setIsLoadingPresentation(false);
      }
    };

    fetchPresentation();
  }, [
    presentationIdFromParams,
    presentationId,
    location.state?.presentation,
    location.state?.presentationId,
    streamingState.isStreaming,
    streamingState.isComplete,
    streamingState.slides.length,
    presentationState,
    isStreamingMode,
    navigate,
  ]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && presentationState) {
      if (currentSlide < presentationState.slides.length - 1) {
        interval = setInterval(() => {
          setCurrentSlide((prev) => {
            const nextIndex = prev + 1;
            const slideElement = document.getElementById(`slide-${nextIndex}`);
            if (slideElement) {
              slideElement.scrollIntoView({
                behavior: "smooth",
                inline: "center",
                block: "nearest",
              });
            }
            return nextIndex;
          });
        }, slideInterval * 1000);
      }
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSlide, presentationState, slideInterval]);

  useEffect(() => {
    if (
      isPlaying &&
      presentationState &&
      currentSlide === presentationState.slides.length - 1
    ) {
      setIsPlaying(false);
    }
  }, [currentSlide, presentationState, isPlaying]);

  useEffect(() => {
    if (thumbnailScrollTimeoutRef.current) {
      clearTimeout(thumbnailScrollTimeoutRef.current);
    }

    thumbnailScrollTimeoutRef.current = setTimeout(() => {
      requestAnimationFrame(() => {
        const currentThumbnail = document.querySelector(
          `[data-slide-index="${currentSlide}"]`,
        );

        if (currentThumbnail) {
          currentThumbnail.scrollIntoView({
            behavior: "smooth",
            inline: "center",
            block: "nearest",
          });
        }
      });
    }, 50);

    return () => {
      if (thumbnailScrollTimeoutRef.current) {
        clearTimeout(thumbnailScrollTimeoutRef.current);
      }
    };
  }, [currentSlide]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-run on presentation changes
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.9) {
            const slideId = entry.target.id;
            const slideIndex = parseInt(slideId.split("-")[1], 10);
            setVisibleSlide(slideIndex);
          }
        });
      },
      {
        root: slideContainerRef.current,
        threshold: [0.9],
        rootMargin: "0px",
      },
    );

    const slideElements = document.querySelectorAll(".slide-carousel__item");
    slideElements.forEach((slide) => {
      observer.observe(slide);
    });

    return () => {
      slideElements.forEach((slide) => {
        observer.unobserve(slide);
      });
    };
  }, [presentationState]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: unstable function refs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setIsPlaying(false);
        prevSlide("auto");
      } else if (e.key === "ArrowRight") {
        setIsPlaying(false);
        nextSlide("auto");
      } else if (e.key === "ArrowUp") {
        setIsPlaying(false);
        skipToFirstSlide("auto");
      } else if (e.key === "ArrowDown") {
        setIsPlaying(false);
        skipToLastSlide("auto");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentSlide, presentationState, isFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (intervalMode === "custom" && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [intervalMode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: update only on slide count
  useEffect(() => {
    const container = slideContainerRef.current;
    if (!container || !presentationState) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const children = Array.from(container.children) as HTMLElement[];
        if (!children.length) {
          ticking = false;
          return;
        }
        const containerRect = container.getBoundingClientRect();
        let nearestIndex = 0;
        let nearestDistance = Infinity;
        children.forEach((child, i) => {
          const rect = child.getBoundingClientRect();
          const childCenter = (rect.left + rect.right) / 2;
          const containerCenter =
            (containerRect.left + containerRect.right) / 2;
          const distance = Math.abs(childCenter - containerCenter);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = i;
          }
        });
        setCurrentSlide(nearestIndex);
        ticking = false;
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, [presentationState?.slides.length]);

  const hasLocationPresentation = !!location.state?.presentation;
  const isLocationStreaming = !!location.state?.isStreaming;
  const hasLocationPresentationId = !!location.state?.presentationId;
  useEffect(() => {
    if (isLoadingPresentation) return;

    // Don't redirect if streaming is in progress OR just completed with data
    if (streamingState.isStreaming) return;
    if (streamingState.isComplete && streamingState.slides.length > 0) return;
    if (presentationState && presentationState.slides.length > 0) return;
    if (presentationId) return;

    if (
      !hasLocationPresentation &&
      !isLocationStreaming &&
      !hasLocationPresentationId
    ) {
      navigate(ROUTES.home);
    }
  }, [
    hasLocationPresentation,
    hasLocationPresentationId,
    isLocationStreaming,
    streamingState.isStreaming,
    streamingState.isComplete,
    streamingState.slides.length,
    presentationState,
    presentationId,
    isLoadingPresentation,
    navigate,
  ]);

  if (
    streamingState.isStreaming &&
    (!presentationState || presentationState.slides.length === 0)
  ) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-white">
          <Spinner className="h-12 w-12" />
          <p className="text-lg">Generating your presentation...</p>
        </div>
      </div>
    );
  }

  if (isLoadingPresentation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-white">
          <Spinner className="h-12 w-12" />
          <p className="text-lg">Loading presentation...</p>
        </div>
      </div>
    );
  }

  if (!presentationState) {
    return null;
  }

  const nextSlide = (scrollBehavior: ScrollBehavior = "smooth") => {
    if (currentSlide < presentationState.slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
      const slideElement = document.getElementById(`slide-${currentSlide + 1}`);
      if (slideElement) {
        slideElement.scrollIntoView({
          behavior: scrollBehavior,
          inline: "center",
          block: "nearest",
        });
      }
    }
  };

  const prevSlide = (scrollBehavior: ScrollBehavior = "smooth") => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
      const slideElement = document.getElementById(`slide-${currentSlide - 1}`);
      if (slideElement) {
        slideElement.scrollIntoView({
          behavior: scrollBehavior,
          inline: "center",
          block: "nearest",
        });
      }
    }
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
    setIsFullscreen(!isFullscreen);
  };

  const togglePlayback = () => {
    if (!isPlaying) {
      if (currentSlide === presentationState.slides.length - 1) {
        setCurrentSlide(0);
        setIsPlaying(true);
      } else {
        setIsPlaying(true);
      }
    } else {
      setIsPlaying(false);
    }
  };

  const skipToFirstSlide = (scrollBehavior: ScrollBehavior = "smooth") => {
    setCurrentSlide(0);
    const slideElement = document.getElementById("slide-0");
    if (slideElement) {
      slideElement.scrollIntoView({
        behavior: scrollBehavior,
        inline: "center",
        block: "nearest",
      });
    }
  };

  const skipToLastSlide = (scrollBehavior: ScrollBehavior = "smooth") => {
    setCurrentSlide(presentationState.slides.length - 1);
    const slideElement = document.getElementById(
      `slide-${presentationState.slides.length - 1}`,
    );
    if (slideElement) {
      slideElement.scrollIntoView({
        behavior: scrollBehavior,
        inline: "center",
        block: "nearest",
      });
    }
  };

  const deleteCurrentSlide = async () => {
    if (!presentationState || presentationState.slides.length === 1) return;

    const slideToDelete = presentationState.slides[currentSlide];
    const slideId = slideToDelete?.id;

    console.log("Deleting slide:", { presentationId, slideId, currentSlide });

    const newSlides = presentationState.slides.filter(
      (_, idx) => idx !== currentSlide,
    );
    let newCurrent = currentSlide;
    if (currentSlide >= newSlides.length) {
      newCurrent = newSlides.length - 1;
    }
    setPresentation({
      ...presentationState,
      slides: newSlides,
      totalSlides: newSlides.length,
    });
    setCurrentSlide(newCurrent);

    if (presentationId && slideId) {
      try {
        const encodedSlideId = encodeURIComponent(slideId);
        const url = `${API_URL}/api/presentations/${presentationId}/slides/${encodedSlideId}`;
        console.log("DELETE request to:", url);

        const response = await fetch(url, {
          method: "DELETE",
          credentials: "include",
        });

        const data = await response.json();
        console.log("Delete response:", response.status, data);

        if (!response.ok) {
          console.error("Failed to delete slide from database:", data);
        } else {
          console.log("Slide deleted from database successfully");
        }
      } catch (error) {
        console.error("Error deleting slide:", error);
      }
    } else {
      console.warn("Cannot delete: missing presentationId or slideId", {
        presentationId,
        slideId,
      });
    }
  };

  const handleIteratePresentation = async (
    prompt: string,
    slideCount: number,
    detailLevel: string,
    tonality: string,
    useWebResearch: boolean,
  ) => {
    if (!prompt.trim() || !presentationId) return;

    const success = await startIterating(
      prompt,
      presentationId,
      slideCount,
      detailLevel,
      tonality,
      useWebResearch,
    );

    if (success) {
      setShowIterateModal(false);
    }
  };

  return (
    <div
      className={`min-h-screen transition-all duration-300 ${
        isFullscreen
          ? "bg-black p-0"
          : "bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-0"
      }`}
      style={{ height: "100vh", minHeight: "100vh", maxHeight: "100vh" }}
    >
      <div
        className={`${
          isFullscreen
            ? "h-screen w-screen flex flex-col"
            : "max-w-[95vw] mx-auto h-full flex flex-col pt-3"
        }`}
        style={{ height: "100vh", minHeight: "100vh", maxHeight: "100vh" }}
      >
        {/* Header Controls */}
        {showControls && !isFullscreen && (
          <div
            className="relative flex items-center justify-between px-6 py-4 flex-shrink-0"
            style={{ minHeight: 48, fontSize: "1rem" }}
          >
            <div className="flex items-center gap-4">
              <Button
                onClick={() => navigate(ROUTES.home)}
                className="bg-transparent hover:bg-white/5 text-white/40 hover:text-white transition-all duration-300 rounded-full p-2 h-10 w-10 border-none shadow-none"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              {/* Title moved to left */}
              {presentationState?.title && (
                <span className="text-white/60 text-lg font-light tracking-wide select-none hidden md:block">
                  {presentationState.title}
                </span>
              )}
            </div>
            {/* Center Controls */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">
              <TemplateSelector
                selectedTemplate={currentTemplate}
                onTemplateChange={changeTemplate}
              />
              {presentationId && (
                <Button
                  onClick={() => setShowIterateModal(true)}
                  variant="outline"
                  className="bg-white/5 hover:bg-white/10 backdrop-blur-lg border border-white/5 text-white transition-all duration-300"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Iterate
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Interval Selector */}
              {intervalMode === "preset" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-24 bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5 transition-all duration-200 justify-between h-9 px-3"
                    >
                      <span>{slideInterval}s</span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-32 bg-gray-900/95 backdrop-blur-md border border-white/10 text-white shadow-xl">
                    {[2, 3, 5, 10, 15].map((val) => (
                      <DropdownMenuItem
                        key={val}
                        onClick={() => {
                          setSlideInterval(val);
                          setCustomInterval(val.toString());
                          setIntervalMode("preset");
                        }}
                        className="focus:bg-white/10 focus:text-white cursor-pointer"
                      >
                        {val}s
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem
                      onClick={() => setIntervalMode("custom")}
                      className="focus:bg-white/10 focus:text-white cursor-pointer"
                    >
                      Custom
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <input
                  ref={customInputRef}
                  type="number"
                  min={0}
                  max={10000}
                  value={customInterval}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^\d{0,5}$/.test(val) && Number(val) <= 10000) {
                      setCustomInterval(val);
                    }
                  }}
                  onBlur={() => {
                    let val = Number(customInterval);
                    if (Number.isNaN(val) || val < 0) val = 0;
                    if (val > 10000) val = 10000;
                    setSlideInterval(val);
                    setCustomInterval(val.toString());
                    setIntervalMode("preset");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      let val = Number(customInterval);
                      if (Number.isNaN(val) || val < 0) val = 0;
                      if (val > 10000) val = 10000;
                      setSlideInterval(val);
                      setCustomInterval(val.toString());
                      setIntervalMode("preset");
                    } else if (e.key === "Escape") {
                      setIntervalMode("preset");
                    }
                  }}
                  className="w-24 px-3 py-2 rounded-md bg-transparent border border-white/5 text-white/60 hover:text-white hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-white/20 hide-number-spin transition-all duration-200 h-9"
                  placeholder="Custom (s)"
                  inputMode="numeric"
                  style={{ MozAppearance: "textfield" }}
                />
              )}

              {/* Play/Pause */}
              <Button
                onClick={togglePlayback}
                variant="outline"
                className="bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5 transition-all duration-200 h-9 px-3"
                disabled={presentationState.slides.length === 1}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsFullscreen(true)}
                className="text-white/60 hover:text-white hover:bg-white/5 h-9 w-9"
              >
                <Maximize className="h-5 w-5" />
              </Button>
            </div>
          </div>
        )}
        {/* Iterate Modal */}
        <IterateModal
          open={showIterateModal}
          onOpenChange={setShowIterateModal}
          onIterate={handleIteratePresentation}
          isStreaming={streamingState.isStreaming}
        />
        {/* Slide Counter */}

        {/* Slides Area (horizontal carousel, fills available space) */}
        {!isFullscreen && (
          <div
            className="flex-1 mt-3 flex flex-col"
            style={{ maxHeight: "calc(100vh - 40px - 28px - 48px - 56px)" }}
          >
            <div
              ref={slideContainerRef}
              className="slide-carousel w-full flex-1"
              role="listbox"
              aria-label="Slides carousel"
            >
              {presentationState.slides.map((slide, idx) => {
                const isActive = visibleSlide === idx;

                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: handled globally
                  // biome-ignore lint/a11y/useFocusableInteractive: handled globally
                  <div
                    key={slide.id || idx}
                    id={`slide-${idx}`}
                    role="option"
                    aria-selected={isActive}
                    className="slide-carousel__item"
                    data-active={isActive}
                    onClick={() => {
                      if (idx !== currentSlide) {
                        setCurrentSlide(idx);
                        const slideElement = document.getElementById(
                          `slide-${idx}`,
                        );
                        if (slideElement) {
                          slideElement.scrollIntoView({
                            behavior: "smooth",
                            inline: "center",
                            block: "nearest",
                          });
                        }
                      }
                    }}
                  >
                    <div className="ss-slide-stage flex-shrink-0 cursor-pointer">
                      <Card
                        className={`w-full h-full rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 flex items-stretch ${
                          currentSlide === idx ? "ring-2 ring-blue-500" : ""
                        }`}
                      >
                        <SlideRenderer
                          slide={slide}
                          currentTemplate={currentTemplate}
                          isActive={currentSlide === idx}
                        />
                      </Card>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Navigation Controls (below slides) */}
        {showControls && !isFullscreen && (
          <div
            className="relative flex items-center mt-3 pt-8 flex-shrink-0"
            style={{ minHeight: 36, fontSize: "0.95rem" }}
          >
            {/* Left-aligned download button */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2">
              <DownloadPPTXButton title={presentationState.title} />
            </div>

            {/* Centered navigation buttons */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsPlaying(false);
                  skipToFirstSlide();
                }}
                disabled={currentSlide === 0}
                className="bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5"
              >
                <SkipBack className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsPlaying(false);
                  prevSlide();
                }}
                disabled={currentSlide === 0}
                className="bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5"
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsPlaying(false);
                  nextSlide();
                }}
                disabled={currentSlide === presentationState.slides.length - 1}
                className="bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsPlaying(false);
                  skipToLastSlide();
                }}
                disabled={currentSlide === presentationState.slides.length - 1}
                className="bg-transparent border-white/5 text-white/60 hover:text-white hover:bg-white/5"
              >
                <SkipForward className="w-4 h-4" />
              </Button>
            </div>
            {/* Right-aligned delete button, vertically centered */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
              <Button
                variant="destructive"
                onClick={deleteCurrentSlide}
                disabled={presentationState.slides.length === 1}
                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 shadow-none transition-all duration-200"
                title="Delete current slide"
              >
                <Trash className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        )}
        {/* Slide Thumbnails (horizontal, below slides) */}
        {showControls && !isFullscreen && (
          <div
            className="w-full overflow-hidden flex-shrink-0 relative"
            style={{ minHeight: 40 }}
          >
            <div className="slide-thumbnails-container flex gap-3 overflow-x-auto py-6 px-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
              {presentationState.slides.map((slide, index) => {
                const isFirstThumbnail = index === 0;
                const isLastThumbnail =
                  index === presentationState.slides.length - 1 &&
                  !(isStreamingMode && streamingState.isStreaming);
                const marginLeft = isFirstThumbnail ? "calc(50vw - 40px)" : "0";
                const marginRight = isLastThumbnail ? "calc(50vw - 40px)" : "0";

                return (
                  <button
                    key={slide.id || index}
                    type="button"
                    data-slide-index={index}
                    onClick={() => {
                      setCurrentSlide(index);
                      setIsPlaying(false);
                      const slideElement = document.getElementById(
                        `slide-${index}`,
                      );
                      if (slideElement) {
                        slideElement.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }
                    }}
                    style={{
                      marginLeft,
                      marginRight,
                    }}
                    className={`w-20 h-14 border-2 rounded-xl flex-shrink-0 transition-all duration-300 overflow-hidden
                      ${
                        currentSlide === index
                          ? "border-blue-500 bg-blue-500/20 shadow-lg shadow-blue-500/50"
                          : "border-white/20 bg-white/10 hover:border-white/40 hover:bg-white/20"
                      }
                      backdrop-blur-sm relative`}
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-sm text-white font-medium">
                        {index + 1}
                      </span>
                    </div>
                  </button>
                );
              })}
              {/* Streaming loading indicator */}
              {isStreamingMode && streamingState.isStreaming && (
                <div
                  style={{
                    marginRight: "calc(50vw - 40px)",
                  }}
                  className="w-20 h-14 border-2 border-dashed border-blue-400/50 rounded-xl flex-shrink-0 overflow-hidden backdrop-blur-sm bg-blue-500/10 flex items-center justify-center"
                >
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                </div>
              )}
            </div>
          </div>
        )}
        {/* Single Slide (fullscreen mode) */}
        {isFullscreen && (
          <div className="flex-1 flex flex-col items-center justify-center overflow-auto">
            <div className="ss-slide-stage">
              <Card className="w-full h-full rounded-none bg-black flex items-center justify-center">
                <SlideRenderer
                  slide={presentationState.slides[currentSlide]}
                  currentTemplate={currentTemplate}
                  isActive={true}
                />
              </Card>
            </div>
          </div>
        )}
        {/* Fullscreen Controls */}
        {isFullscreen && (
          // biome-ignore lint/a11y/noStaticElementInteractions: UI hover effect
          <div
            className={`
              fixed bottom-4 left-1/2 transform -translate-x-1/2 
              flex items-center gap-4 bg-black/50 backdrop-blur-md rounded-full px-6 py-3
              transition-opacity duration-300
              ${showControls ? "opacity-100" : "opacity-0"}
            `}
            onMouseEnter={() => setShowControls(true)}
          >
            {/* Interval Selector and Play/Pause Button */}
            <div className="flex items-center gap-2">
              {intervalMode === "preset" ? (
                <Select
                  value={slideInterval.toString()}
                  onValueChange={(v) => {
                    if (v === "custom") {
                      setIntervalMode("custom");
                    } else {
                      setSlideInterval(Number(v));
                      setCustomInterval(v);
                      setIntervalMode("preset");
                    }
                  }}
                >
                  <SelectTrigger
                    className={`w-24 text-white ${
                      isFullscreen
                        ? "bg-transparent border-0 shadow-none hover:bg-white/20"
                        : "bg-white/10 border-white/20 hover:bg-white/20"
                    }`}
                  >
                    {!["2", "3", "5", "10", "15"].includes(
                      slideInterval.toString(),
                    ) && slideInterval !== 0 ? (
                      <span>{slideInterval}s</span>
                    ) : (
                      <SelectValue />
                    )}
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800/95 backdrop-blur-md border-gray-600 text-white">
                    <SelectItem value="2">2s</SelectItem>
                    <SelectItem value="3">3s</SelectItem>
                    <SelectItem value="5">5s</SelectItem>
                    <SelectItem value="10">10s</SelectItem>
                    <SelectItem value="15">15s</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <input
                  ref={customInputRef}
                  type="number"
                  min={0}
                  max={10000}
                  value={customInterval}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^\d{0,5}$/.test(val) && Number(val) <= 10000) {
                      setCustomInterval(val);
                    }
                  }}
                  onBlur={() => {
                    let val = Number(customInterval);
                    if (Number.isNaN(val) || val < 0) val = 0;
                    if (val > 10000) val = 10000;
                    setSlideInterval(val);
                    setCustomInterval(val.toString());
                    setIntervalMode("preset");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      let val = Number(customInterval);
                      if (Number.isNaN(val) || val < 0) val = 0;
                      if (val > 10000) val = 10000;
                      setSlideInterval(val);
                      setCustomInterval(val.toString());
                      setIntervalMode("preset");
                    } else if (e.key === "Escape") {
                      setIntervalMode("preset");
                    }
                  }}
                  className={`w-24 px-3 py-2 rounded-md border ${
                    isFullscreen
                      ? "bg-transparent border-0 shadow-none text-white hover:bg-white/20"
                      : "border-white/20 bg-white/10 text-white"
                  } focus:outline-none focus:ring-2 focus:ring-blue-400 hide-number-spin`}
                  placeholder="Custom (s)"
                  inputMode="numeric"
                  style={{ MozAppearance: "textfield" }}
                />
              )}
              <Button
                onClick={togglePlayback}
                variant={isFullscreen ? "ghost" : "outline"}
                className={
                  isFullscreen
                    ? "text-white hover:bg-white/20"
                    : "bg-white/10 border-white/20 text-white hover:bg-white/20"
                }
                disabled={presentationState.slides.length === 1}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4 mr-2" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Play
                  </>
                )}
              </Button>
            </div>
            {/* Navigation and Exit Buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setIsPlaying(false);
                  skipToFirstSlide();
                }}
                disabled={currentSlide === 0}
                className="text-white hover:bg-white/20"
              >
                <SkipBack className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setIsPlaying(false);
                  prevSlide();
                }}
                disabled={currentSlide === 0}
                className="text-white hover:bg-white/20"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setIsPlaying(false);
                  nextSlide();
                }}
                disabled={currentSlide === presentationState.slides.length - 1}
                className="text-white hover:bg-white/20"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setIsPlaying(false);
                  skipToLastSlide();
                }}
                disabled={currentSlide === presentationState.slides.length - 1}
                className="text-white hover:bg-white/20"
              >
                <SkipForward className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                onClick={toggleFullscreen}
                className="text-white hover:bg-white/20"
              >
                Exit
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PresentationViewer;
