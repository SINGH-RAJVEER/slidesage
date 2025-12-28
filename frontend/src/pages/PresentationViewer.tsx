import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Play,
  Pause,
  Maximize,
  SkipBack,
  SkipForward,
  Trash,
} from "lucide-react";
import DownloadPPTXButton from "@/components/Viewer/DownloadPPTXButton";
import ChartRenderer from "@/components/Charts/ChartRenderer";
import TemplateApplier from "@/components/Viewer/TemplateApplier";
import TemplateSelector from "@/components/Viewer/TemplateSelector";
import { useTemplate } from "@/hooks/useTemplate";
import { AVAILABLE_TEMPLATES } from "@/types/template";
import type {
  PresentationData,
  Slide,
  HtmlSlide,
  ChartSlide,
} from "@/types/presentation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PresentationViewer: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const presentation: PresentationData | undefined =
    location.state?.presentation;

  const [presentationState, setPresentation] = useState<
    PresentationData | undefined
  >(presentation);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [slideInterval, setSlideInterval] = useState(5);
  const [intervalMode, setIntervalMode] = useState("preset");
  const [customInterval, setCustomInterval] = useState("5");
  const customInputRef = useRef<HTMLInputElement>(null);
  const slideContainerRef = useRef<HTMLDivElement | null>(null);

  const { currentTemplate, changeTemplate } = useTemplate();

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && currentSlide < presentationState!.slides.length - 1) {
      interval = setInterval(() => {
        nextSlide();
      }, slideInterval * 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSlide, presentationState, slideInterval]);

  useEffect(() => {
    if (isPlaying && currentSlide === presentationState!.slides.length - 1) {
      setIsPlaying(false);
    }
  }, [currentSlide, presentationState, isPlaying]);

  useEffect(() => {
    const thumbnailContainer = document.querySelector(
      ".slide-thumbnails-container"
    );
    const currentThumbnail = document.querySelector(
      `[data-slide-index="${currentSlide}"]`
    );

    if (thumbnailContainer && currentThumbnail) {
      const containerRect = thumbnailContainer.getBoundingClientRect();
      const thumbnailRect = currentThumbnail.getBoundingClientRect();

      const thumbnailLeft = thumbnailRect.left - containerRect.left;
      const thumbnailRight = thumbnailLeft + thumbnailRect.width;

      const isOutsideLeft = thumbnailLeft < 0;
      const isOutsideRight = thumbnailRight > containerRect.width;

      if (isOutsideLeft || isOutsideRight) {
        const targetScrollLeft =
          thumbnailContainer.scrollLeft +
          thumbnailLeft -
          containerRect.width / 2 +
          thumbnailRect.width / 2;

        const maxScrollLeft =
          thumbnailContainer.scrollWidth - containerRect.width;
        const clampedScrollLeft = Math.max(
          0,
          Math.min(targetScrollLeft, maxScrollLeft)
        );

        thumbnailContainer.scrollTo({
          left: clampedScrollLeft,
          behavior: "smooth",
        });
      }
    }
  }, [currentSlide]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Primary navigation: Left/Right for prev/next; Up/Down to jump to first/last
      if (e.key === "ArrowLeft") {
        prevSlide();
      } else if (e.key === "ArrowRight") {
        nextSlide();
      } else if (e.key === "ArrowUp") {
        // Jump to first slide
        skipToFirstSlide();
      } else if (e.key === "ArrowDown") {
        // Jump to last slide
        skipToLastSlide();
      } else if (e.key === "Escape") {
        if (isFullscreen) {
          document.exitFullscreen();
          setIsFullscreen(false);
        }
      } else if (e.key === "f" || e.key === "F") {
        if (!isFullscreen) {
          document.documentElement.requestFullscreen();
          setIsFullscreen(true);
        }
        // Home/End to jump to first/last slide (also supported)
      } else if (e.key === "Home") {
        skipToFirstSlide();
      } else if (e.key === "End") {
        skipToLastSlide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentSlide, presentationState, isFullscreen]);

  useEffect(() => {
    if (intervalMode === "custom" && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [intervalMode]);

  if (!presentationState) {
    navigate("/");
    return null;
  }

  const nextSlide = () => {
    if (currentSlide < presentationState.slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
      setIsPlaying(false);
      const slideElement = document.getElementById(`slide-${currentSlide + 1}`);
      if (slideElement) {
        slideElement.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
      }
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
      setIsPlaying(false);
      const slideElement = document.getElementById(`slide-${currentSlide - 1}`);
      if (slideElement) {
        slideElement.scrollIntoView({
          behavior: "smooth",
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
      // If at the last slide, reset to first before playing
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

  const skipToFirstSlide = () => {
    setCurrentSlide(0);
    setIsPlaying(false);
    const slideElement = document.getElementById("slide-0");
    if (slideElement) {
      slideElement.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  };

  const skipToLastSlide = () => {
    setCurrentSlide(presentationState.slides.length - 1);
    setIsPlaying(false);
    const slideElement = document.getElementById(
      `slide-${presentationState.slides.length - 1}`
    );
    if (slideElement) {
      slideElement.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  };

  // Sync currentSlide with carousel scroll position
  useEffect(() => {
    const container = slideContainerRef.current;
    if (!container) return;

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
    // run once to ensure state sync
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, [presentationState.slides.length]);

  const deleteCurrentSlide = () => {
    if (!presentationState || presentationState.slides.length === 1) return;
    const newSlides = presentationState.slides.filter(
      (_, idx) => idx !== currentSlide
    );
    let newCurrent = currentSlide;
    if (currentSlide >= newSlides.length) {
      newCurrent = newSlides.length - 1;
    }
    setPresentation({ ...presentationState, slides: newSlides });
    setCurrentSlide(newCurrent);
  };

  const renderSlideContent = (slide: Slide) => {
    const template = AVAILABLE_TEMPLATES.find((t) => t.id === currentTemplate);
    const textColor = template?.styles.slideContent.color || "white";

    if (slide.type === "chart") {
      const chartSlide = slide as ChartSlide;
      return (
        <TemplateApplier templateId={currentTemplate} className="w-full h-full">
          <div
            id="slide-content"
            className="w-full h-full flex items-center justify-center"
          >
            <ChartRenderer
              chartConfig={chartSlide.chartConfig}
              className="w-full h-full"
              textColor={textColor}
            />
          </div>
        </TemplateApplier>
      );
    } else {
      const htmlSlide = slide as HtmlSlide;
      return (
        <TemplateApplier templateId={currentTemplate} className="w-full h-full">
          <div
            className="w-full h-full flex flex-col justify-center"
            dangerouslySetInnerHTML={{
              __html:
                htmlSlide.html ||
                '<div id="slide-content"><p id="slide-description">No content available</p></div>',
            }}
          />
        </TemplateApplier>
      );
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
            : "max-w-7xl mx-auto h-full flex flex-col pt-3"
        }`}
        style={{ height: "100vh", minHeight: "100vh", maxHeight: "100vh" }}
      >
        {/* Header Controls */}
        {showControls && !isFullscreen && (
          <div
            className="relative flex items-center justify-between bg-white/10 backdrop-blur-md rounded-2xl px-3 py-2 border border-white/20 flex-shrink-0"
            style={{ minHeight: 40, fontSize: "0.95rem" }}
          >
            <div className="flex items-center gap-4">
              <Button
                onClick={() => navigate("/")}
                variant="outline"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                ← Back to Generator
              </Button>
              <DownloadPPTXButton title={presentationState.title} />
              <TemplateSelector
                selectedTemplate={currentTemplate}
                onTemplateChange={changeTemplate}
              />
            </div>
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/80 text-sm font-medium select-none pointer-events-none bg-white/10 border border-white/20 px-4 py-1 rounded-full shadow-sm">
              Slide {currentSlide + 1} of {presentationState.slides.length}
            </span>
            <div className="flex items-center gap-4">
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
                        slideInterval.toString()
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
                      if (isNaN(val) || val < 0) val = 0;
                      if (val > 10000) val = 10000;
                      setSlideInterval(val);
                      setCustomInterval(val.toString());
                      setIntervalMode("preset");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        let val = Number(customInterval);
                        if (isNaN(val) || val < 0) val = 0;
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
                <Button
                  onClick={toggleFullscreen}
                  variant="outline"
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                >
                  <Maximize className="w-4 h-4 mr-2" />
                  Fullscreen
                </Button>
                <Button
                  variant="outline"
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* Slide Counter */}
        {showControls && !isFullscreen && <></>}
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
              {presentationState.slides.map((slide, idx) => (
                <div
                  key={idx}
                  id={`slide-${idx}`}
                  role="option"
                  aria-selected={currentSlide === idx}
                  className="slide-carousel__item"
                >
                  <div className="w-full max-w-[90vw] mx-auto aspect-video flex-shrink-0">
                    <Card
                      className={`w-full h-full rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 flex items-stretch ${
                        currentSlide === idx ? "ring-2 ring-blue-500" : ""
                      }`}
                    >
                      {renderSlideContent(slide)}
                    </Card>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Navigation Controls (below slides) */}
        {showControls && !isFullscreen && (
          <div
            className="relative flex items-center mt-3 pt-8 flex-shrink-0"
            style={{ minHeight: 36, fontSize: "0.95rem" }}
          >
            {/* Centered navigation buttons */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2">
              <Button
                variant="outline"
                onClick={skipToFirstSlide}
                disabled={currentSlide === 0}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <SkipBack className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                onClick={prevSlide}
                disabled={currentSlide === 0}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={nextSlide}
                disabled={currentSlide === presentationState.slides.length - 1}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                onClick={skipToLastSlide}
                disabled={currentSlide === presentationState.slides.length - 1}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
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
                className="bg-red-600/80 border-red-600/40 text-white hover:bg-red-700/90"
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
            className="w-full overflow-hidden flex-shrink-0"
            style={{ minHeight: 40 }}
          >
            <div className="slide-thumbnails-container flex gap-3 overflow-x-auto py-6 px-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
              <div className="flex gap-3 min-w-max mx-auto">
                {presentationState.slides.map((slide, index) => (
                  <button
                    key={index}
                    data-slide-index={index}
                    onClick={() => {
                      setCurrentSlide(index);
                      setIsPlaying(false);
                      const slideElement = document.getElementById(
                        `slide-${index}`
                      );
                      if (slideElement) {
                        slideElement.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }
                    }}
                    className={`w-20 h-14 border-2 rounded-xl flex-shrink-0 transition-all duration-300
                      ${
                        currentSlide === index
                          ? "border-blue-500 bg-blue-500/20 shadow-lg shadow-blue-500/25 scale-110"
                          : "border-white/20 bg-white/10 hover:border-white/40 hover:bg-white/20"
                      }
                      backdrop-blur-sm relative`}
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-xs text-white font-medium">
                        {index + 1}
                      </span>
                      {slide.type === "chart" && (
                        <div className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full"></div>
                      )}
                      {(slide as HtmlSlide).html?.includes(
                        'id="slide-table"'
                      ) && (
                        <div className="absolute top-0 left-0 w-2 h-2 bg-yellow-500 rounded-full"></div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* Single Slide (fullscreen mode) */}
        {isFullscreen && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-full max-w-[98vw] h-full flex items-center justify-center">
              <Card className="w-full h-full rounded-none bg-black flex items-center justify-center aspect-video">
                {renderSlideContent(presentationState.slides[currentSlide])}
              </Card>
            </div>
          </div>
        )}
        {/* Fullscreen Controls */}
        {isFullscreen && (
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
                      slideInterval.toString()
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
                    if (isNaN(val) || val < 0) val = 0;
                    if (val > 10000) val = 10000;
                    setSlideInterval(val);
                    setCustomInterval(val.toString());
                    setIntervalMode("preset");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      let val = Number(customInterval);
                      if (isNaN(val) || val < 0) val = 0;
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
                onClick={skipToFirstSlide}
                disabled={currentSlide === 0}
                className="text-white hover:bg-white/20"
              >
                <SkipBack className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                onClick={prevSlide}
                disabled={currentSlide === 0}
                className="text-white hover:bg-white/20"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                onClick={nextSlide}
                disabled={currentSlide === presentationState.slides.length - 1}
                className="text-white hover:bg-white/20"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                onClick={skipToLastSlide}
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
