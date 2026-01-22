export interface ChartConfig {
  type: string;
  data: Record<string, unknown>;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Slide {
  id: string;
  type: 'title' | 'content' | 'chart' | string;
  html: string;
  chartConfig?: ChartConfig;
  notes?: string;
  [key: string]: unknown;
}

export interface PresentationJSON {
  title: string;
  theme: string;
  slides: Slide[];
  totalSlides?: number;
  tokens_used?: number;
  [key: string]: unknown;
}

export type PresentationStreamEvent =
  | { event: 'start'; data: { status: string } }
  | { event: 'theme'; data: { theme: string } }
  | { event: 'slide'; data: { slide: Slide; index: number; title: string | null } }
  | { event: 'complete'; data: PresentationJSON }
  | { event: 'error'; data: { error: string } };

export interface LiteLLMMessage {
  role: string;
  content: string;
}

export interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
}
