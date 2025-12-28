import React from "react";
import PptxGenJS from "pptxgenjs";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
}

const DownloadPPTXButton: React.FC<Props> = ({ title }) => {
  const download = async () => {
    const pptx = new PptxGenJS();
    const safeTitle = title || "Untitled Presentation";
    pptx.author = "AI PPT Maker";
    pptx.company = "AI PPT Maker";
    pptx.title = safeTitle;
    pptx.subject = safeTitle;
    pptx.layout = "LAYOUT_16x9";

    // Get all slide items from the carousel
    const slideNodes = Array.from(
      document.querySelectorAll(".slide-carousel__item")
    ) as HTMLElement[];

    const images: string[] = [];
    for (const node of slideNodes) {
      try {
        // Find the actual content within each slide
        const contentNode = (node.querySelector('[id="slide-content"]') ||
          node.querySelector(".template-applier") ||
          node) as HTMLElement;

        const dataUrl = await toPng(contentNode, {
          backgroundColor: "#1f2937",
          cacheBust: true,
          pixelRatio: 2,
          skipFonts: true,
          skipAutoScale: false,
          preferredFontFormat: "woff",
          filter: (node) => {
            // Skip images that might have CORS issues
            if (node instanceof HTMLImageElement) {
              // Only include images that are from the same origin or have been successfully loaded
              return node.complete && node.naturalHeight !== 0;
            }
            return true;
          },
        });
        images.push(dataUrl);
      } catch (error) {
        console.error("Error capturing slide:", error);
        // Continue with other slides even if one fails
      }
    }

    if (images.length === 0) {
      alert("Failed to capture slides. Please try again.");
      return;
    }

    images.forEach((img) => {
      const slide = pptx.addSlide();
      slide.addImage({
        data: img,
        x: 0,
        y: 0,
        w: 10,
        h: 5.625,
      });
    });

    await pptx.writeFile({ fileName: `${safeTitle}.pptx` });
  };

  return (
    <Button
      onClick={download}
      variant="outline"
      className="bg-blue-500/20 border-blue-400/30 text-blue-300 hover:bg-blue-500/30 hover:border-blue-400/50 transition-all duration-200"
    >
      Download PPTX
    </Button>
  );
};

export default DownloadPPTXButton;
