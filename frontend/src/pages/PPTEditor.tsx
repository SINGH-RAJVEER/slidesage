import Canvas from "@/components/Editor/Canvas";
import Sidebar from "@/components/Editor/Sidebar";
import {useRef} from 'react';

const PPTEditor: React.FC = () => {
  const canvasRef = useRef<{ addObject: (type: string, options?: any) => void }>(null);

  const handleAddObject = (type: string, options?: any) => {
    canvasRef.current?.addObject(type, options);
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar onAddObject={handleAddObject} />
      <main className="flex-1 flex items-center justify-center">
        <Canvas ref={canvasRef} />
      </main>
    </div>
  );
};

export default PPTEditor;