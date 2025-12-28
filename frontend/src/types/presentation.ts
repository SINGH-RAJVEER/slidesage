export interface BaseSlide {
  id: string;
  type: string;
}

export interface HtmlSlide extends BaseSlide {
  type: 'title' | 'content' | 'image' | 'quote' | 'list' | 'conclusion';
  html: string;
}

export interface ChartSlide extends BaseSlide {
  type: 'chart';
  chartConfig: {
    type: 'bar' | 'line' | 'pie' | 'doughnut' | 'radar' | 'polarArea';
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
    options?: any;
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