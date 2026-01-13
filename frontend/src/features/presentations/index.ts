// Presentations feature exports
export { StreamingProvider, useStreaming } from "./contexts/StreamingContext";
export { useTemplate } from "./useTemplate";

// Pages
export { default as GeneratePPTPage } from "./pages/GeneratePPTPage";
export { default as PresentationViewer } from "./pages/PresentationViewer";
export { default as PresentationsGridPage } from "./pages/PresentationsGridPage";
export { default as PresentationErrorPage } from "./pages/PresentationErrorPage";
export { default as PurchaseTokensPage } from "./pages/PurchaseTokensPage";

// Types
export type {
  BaseSlide,
  HtmlSlide,
  ChartSlide,
  Slide,
  PresentationData,
  StreamStartEvent,
  StreamThemeEvent,
  StreamSlideEvent,
  StreamCompleteEvent,
  StreamErrorEvent,
  StreamEvent,
} from "./types/presentation";

export type { Template } from "./types/template";
export { AVAILABLE_TEMPLATES } from "./types/template";
