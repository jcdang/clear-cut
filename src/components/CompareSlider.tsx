import { useState, useRef, useCallback, useEffect } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CompareSliderProps {
  originalUrl: string;
  resultUrl: string;
  backgroundStyle?: React.CSSProperties;
  className?: string;
}

export function CompareSlider({
  originalUrl,
  resultUrl,
  backgroundStyle,
  className,
}: CompareSliderProps) {
  const [position, setPosition] = useState(50);
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if (!isDragging.current || !sliderRef.current) return;

      const rect = sliderRef.current.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(("clientX" in e ? e.clientX : 0) - rect.left, rect.width),
      );
      const percentage = (x / rect.width) * 100;

      setPosition(percentage);
    },
    [],
  );

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
      className={cn(
        "relative rounded-3xl overflow-hidden select-none touch-none shadow-md border-2 border-primary/20 group",
        naturalRatio ? "w-full max-h-full" : "w-full h-full",
        className,
      )}
      style={naturalRatio ? { aspectRatio: String(naturalRatio) } : undefined}
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
        style={
          (!backgroundStyle ||
            backgroundStyle.backgroundColor === "transparent") &&
          !backgroundStyle?.backgroundImage
            ? {}
            : { display: "none" }
        }
      />
      <div
        className="absolute inset-0"
        style={
          backgroundStyle &&
          (backgroundStyle.backgroundColor !== "transparent" ||
            backgroundStyle.backgroundImage)
            ? backgroundStyle
            : undefined
        }
      />

      <img
        src={resultUrl}
        alt="Result"
        className="absolute inset-0 w-full h-full object-contain drop-shadow-2xl"
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            setNaturalRatio(img.naturalWidth / img.naturalHeight);
          }
        }}
      />

      <div
        className="absolute inset-0 w-full h-full"
        style={{
          clipPath: `polygon(0 0, ${position}% 0, ${position}% 100%, 0 100%)`,
        }}
      >
        <div className="absolute inset-0 bg-muted" />
        <img
          src={originalUrl}
          alt="Original"
          className="absolute inset-0 w-full h-full object-contain"
          draggable={false}
        />
      </div>

      <div
        className="absolute top-1/2 -translate-y-1/2 w-9 h-9 bg-white rounded-full shadow-lg flex items-center justify-center cursor-ew-resize z-10 ring-1 ring-black/10"
        style={{ left: `${position}%`, transform: "translate(-50%, -50%)" }}
      >
        <ChevronsLeftRight className="w-4 h-4 text-slate-700" />
      </div>

      <div className="absolute top-3 left-3 bg-black/40 backdrop-blur-sm text-white px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide pointer-events-none z-20 select-none">
        BEFORE
      </div>
      <div className="absolute top-3 right-3 bg-black/40 backdrop-blur-sm text-white px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide pointer-events-none z-20 select-none">
        AFTER
      </div>
    </div>
  );
}
