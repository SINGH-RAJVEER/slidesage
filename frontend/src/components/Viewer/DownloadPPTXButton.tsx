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

    const slideNodes = Array.from(
      document.querySelectorAll("#slide-content")
    ) as HTMLElement[];

    const images: string[] = [];
    for (const node of slideNodes) {
      const dataUrl = await toPng(node, {
        backgroundColor: "#1f2937", 
        cacheBust: true,
        pixelRatio: 2, 
      });
      images.push(dataUrl);
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
      className="bg-white/10 border-white/20 text-white hover:bg-white/20"
    >
      Download PPTX
    </Button>
  );
};

export default DownloadPPTXButton;
