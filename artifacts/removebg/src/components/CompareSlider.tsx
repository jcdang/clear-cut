import { useState, useRef, useCallback, useEffect } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CompareSliderProps {
  originalUrl: string;
  resultUrl: string;
  backgroundStyle?: React.CSSProperties;
  className?: string;
}

export function CompareSlider({ originalUrl, resultUrl, backgroundStyle, className }: CompareSliderProps) {
  const [position, setPosition] = useState(50);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerMove = useCallback((e: React.PointerEvent | PointerEvent) => {
    if (!isDragging.current || !sliderRef.current) return;
    
    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(('clientX' in e ? e.clientX : 0) - rect.left, rect.width));
    const percentage = (x / rect.width) * 100;
    
    setPosition(percentage);
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => handlePointerMove(e);
    const handleUp = () => {
      isDragging.current = false;
    };
    
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [handlePointerMove]);

  return (
    <div 
      ref={sliderRef}
      className={cn("relative w-full aspect-square sm:aspect-video rounded-3xl overflow-hidden select-none touch-none shadow-md border-2 border-primary/20 group", className)}
      onPointerDown={(e) => {
        const rect = sliderRef.current?.getBoundingClientRect();
        if (rect) {
          const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
          setPosition((x / rect.width) * 100);
        }
        isDragging.current = true;
      }}
    >
      <div 
        className="absolute inset-0 bg-checkerboard opacity-60" 
        style={(!backgroundStyle || backgroundStyle.backgroundColor === 'transparent') && !backgroundStyle?.backgroundImage ? {} : { display: 'none' }}
      />
      <div 
        className="absolute inset-0"
        style={backgroundStyle && (backgroundStyle.backgroundColor !== 'transparent' || backgroundStyle.backgroundImage) ? backgroundStyle : undefined}
      />
      
      <img src={resultUrl} alt="Result" className="absolute inset-0 w-full h-full object-contain drop-shadow-2xl" draggable={false} />

      <div 
        className="absolute inset-0 w-full h-full"
        style={{ clipPath: `polygon(0 0, ${position}% 0, ${position}% 100%, 0 100%)` }}
      >
        <div className="absolute inset-0 bg-muted" />
        <img src={originalUrl} alt="Original" className="absolute inset-0 w-full h-full object-contain" draggable={false} />
      </div>

      <div 
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)] cursor-ew-resize z-10"
        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
      >
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center pointer-events-none"
        >
          <ChevronsLeftRight className="w-4 h-4 text-slate-800" />
        </div>
      </div>

      <div className="absolute top-4 left-4 bg-black/50 backdrop-blur text-white px-3 py-1 rounded-full text-xs font-medium opacity-0 transition-opacity pointer-events-none group-hover:opacity-100 z-20">
        Before
      </div>
      <div className="absolute top-4 right-4 bg-black/50 backdrop-blur text-white px-3 py-1 rounded-full text-xs font-medium opacity-0 transition-opacity pointer-events-none group-hover:opacity-100 z-20">
        After
      </div>
    </div>
  );
}
