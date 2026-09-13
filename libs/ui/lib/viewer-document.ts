import type { PptxViewer } from "@aiden0z/pptx-renderer";

export type ViewerDocument =
	| {
			kind: "pptx";
			viewer: PptxViewer;
			slideCount: number;
	  }
	| {
			kind: "images";
			slides: string[];
			slideCount: number;
	  };
