import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import * as fabric from 'fabric';

export interface CanvasHandle {
  addObject: (type: string, options?: any) => void;
}

interface CanvasProps {
  width?: number;
  height?: number;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(
  ({ width = 1200, height = 800 }, ref) => {

    const [selectedObject, setSelectedObject] = useState<fabric.Object | null>(null);
    const [iconPosition, setIconPosition] = useState<{ left: number; top: number } | null>(null);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const fabricRef = useRef<any>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDelete = () => {
      if (selectedObject && fabricRef.current) {
        fabricRef.current.remove(selectedObject);
        fabricRef.current.discardActiveObject();
        fabricRef.current.requestRenderAll();
        setSelectedObject(null);
        setIconPosition(null);
      }
    };

    const handleSelection = useCallback(() => {
      const active = fabricRef.current?.getActiveObject();
      if (active) {
        setSelectedObject(active);
        const bound = active.getBoundingRect();
        setIconPosition({
          left: bound.left + bound.width / 2,
          top: bound.top - 30,
        });
      } else {
        setSelectedObject(null);
        setIconPosition(null);
      }
    }, []);

    useEffect(() => {
      if (!fabric || !fabric.Canvas) {
        setError("Fabric.js not loaded properly");
        return;
      }

      if (!canvasRef.current) {
        setError("Canvas element not found");
        return;
      }

      try {
        const fabricCanvas = new fabric.Canvas(canvasRef.current, {
          width,
          height,
          backgroundColor: "#f8f9fa",
          selection: true,
        });

        fabricRef.current = fabricCanvas;

        setIsLoaded(true);
        setError(null);

        fabricRef.current.on("selection:created", handleSelection);
        fabricRef.current.on("selection:updated", handleSelection);
        fabricRef.current.on("selection:cleared", handleSelection);
      } catch (err) {
        console.error("Error initializing Fabric.js canvas:", err);
        setError(`Initialization error: ${err}`);
      }

      return () => {
        if (fabricRef.current) {
          try {
            fabricRef.current.off("selection:created", handleSelection);
            fabricRef.current.off("selection:updated", handleSelection);
            fabricRef.current.off("selection:cleared", handleSelection);
            fabricRef.current.dispose();
            fabricRef.current = null;
          } catch (err) {
            console.error("Error during cleanup:", err);
          }
        }
      };
    }, [width, height, handleSelection]);

    useImperativeHandle(ref, () => ({
      addObject: (type: string, options?: any) => {
        if (!fabricRef.current) return;
        let obj;
        switch (type) {
          case "rectangle":
            obj = new fabric.Rect({
              left: 100,
              top: 100,
              fill: "#3498db",
              width: 120,
              height: 80,
              hasControls: true,
              hasBorders: true,
              selectable: true,
            });
            break;
          case "circle":
            obj = new fabric.Circle({
              left: 150,
              top: 150,
              fill: "#2ecc71",
              radius: 60,
              hasControls: true,
              hasBorders: true,
              selectable: true,
            });
            break;
          case "triangle":
            obj = new fabric.Triangle({
              left: 200,
              top: 200,
              fill: "#f39c12",
              width: 100,
              height: 100,
              hasControls: true,
              hasBorders: true,
              selectable: true,
            });
            break;
            case "text":
              obj = new fabric.IText("Double click to edit", {
              left: 250,
              top: 250,
              fontSize: 32,
              fill: "#222",
              fontFamily: "Arial",
              hasControls: true,
              hasBorders: true,
              selectable: true,
            });
            break;
            case "line":
              const style = options?.style || "solid";
              if (style === "solid") {
                obj = new fabric.Line([100, 100, 300, 100], {
                  stroke: "#333",
                  strokeWidth: 4,
                });
              } else if (style === "dashed") {
                obj = new fabric.Line([100, 150, 300, 150], {
                  stroke: "#333",
                  strokeWidth: 4,
                  strokeDashArray: [10, 10],
                });
              } else if (style === "arrow") {
                obj = new fabric.Group([
                  new fabric.Line([100, 200, 300, 200], {
                    stroke: "#333",
                    strokeWidth: 4,
                  }),
              new fabric.Triangle({
                left: 300,
                top: 200,
                width: 16,
                height: 16,
                angle: 90,
                fill: "#333",
                selectable: false,
                originX: "center",
                originY: "center",
              }),
            ]);
          }
          break;
          case "image":
            if (options?.src) {
              console.log("image source:", options?.src)
              fabric.FabricImage.fromURL(
                options.src,
                undefined,
                (img: any) => {
                  img.set({
                    left: 300,
                    top: 300,
                    scaleX: 0.5,
                    scaleY: 0.5,
                    hasControls: true,
                    hasBorders: true,
                    selectable: true,
                  });
                  fabricRef.current.add(img);
                  fabricRef.current.setActiveObject(img);
                  fabricRef.current.renderAll();
                }
              );
            }
            return;
          default:
            return;
        }
        fabricRef.current.add(obj);
        fabricRef.current.setActiveObject(obj);
        fabricRef.current.renderAll();
      },
    }));

    if (error) {
      return (
        <div
          className="border-2 border-dashed border-red-500 p-5 text-red-500 rounded-lg text-center"
        >
          <h3>Canvas Error</h3>
          <p>{error}</p>
          <small>Check console for more details</small>
        </div>
      );
    }

return (
  <div style={{ position: "relative", display: "inline-block" }}>
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        display: "block",
        opacity: isLoaded ? 1 : 0.5,
        transition: "opacity 0.3s ease",
        borderRadius: "8px",
      }}
    />
    {iconPosition &&
      iconPosition.left !== undefined &&
      iconPosition.top !== undefined && (
        <button
          onClick={handleDelete}
          style={{
            position: "absolute",
            left: iconPosition.left - 16,
            top: iconPosition.top,
            zIndex: 10,
            background: "#fff",
            border: "1px solid #e74c3c",
            borderRadius: "50%",
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            cursor: "pointer",
          }}
          title="Delete"
        >
          {/* SVG trash icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      )}
  </div>
);
  }
);

export default Canvas;