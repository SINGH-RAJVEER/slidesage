export interface BaseSlide {
  id: string;
  type: string;
}

export interface HtmlSlide extends BaseSlide {
  type: "title" | "content" | "image" | "quote" | "list" | "conclusion";
  html: string;
}

export interface ChartSlide extends BaseSlide {
  type: "chart";
  chartConfig: {
    type: "bar" | "line" | "pie" | "doughnut" | "radar" | "polarArea";
    data: {
      labels: string[];
      datasets: Array<{
        label: string;
        data: number[];
        backgroundColor?: string | string[];
        borderColor?: string | string[];
        borderWidth?: number;
        fill?: boolean;
      }>;
    };
    options?: Record<string, unknown>;
    title?: string;
    description?: string;
  };
}

export type Slide = HtmlSlide | ChartSlide;

export interface PresentationData {
  title: string;
  theme: string;
  slides: Slide[];
  totalSlides: number;
}

export interface Source {
  url: string;
  title?: string;
  snippet?: string;
  retrieved_at?: string;
}

// Streaming event types
export interface StreamStartEvent {
  event: "start";
  data: { status: string };
}

export interface StreamThemeEvent {
  event: "theme";
  data: { theme: string };
}

export interface StreamMidwayspaceEvent {
  event: "midwayspace";
  data: { summary: string; sources: Source[] };
}

export interface StreamSlideEvent {
  event: "slide";
  data: {
    slide: Slide;
    index: number;
    title: string | null;
  };
}

export interface StreamCompleteEvent {
  event: "complete";
  data: PresentationData;
}

export interface StreamSavedEvent {
  event: "saved";
  data: { presentation_id: number };
}

export interface StreamErrorEvent {
  event: "error";
  data: { error: string };
}

export type StreamEvent =
  | StreamStartEvent
  | StreamMidwayspaceEvent
  | StreamThemeEvent
  | StreamSlideEvent
  | StreamCompleteEvent
  | StreamSavedEvent
  | StreamErrorEvent;

// Streaming presentation state
export interface StreamingPresentationState {
  isStreaming: boolean;
  theme?: string;
  title?: string;
  slides: Slide[];
  totalSlides?: number;
  presentationId?: number;
  error?: string;
  researchSummary?: string;
  researchSources?: Source[];
}
