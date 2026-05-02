import { useState, useCallback, useRef, useEffect } from "react";
import type React from "react";
import { removeBackground } from "@imgly/background-removal";
import { UploadCloud, Download, RefreshCw, Wand2, Zap, ShieldCheck, CheckCircle2, Clipboard, ImagePlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CompareSlider } from "@/components/CompareSlider";
import JSZip from "jszip";

type AppState = "upload" | "processing" | "result";

interface ProcessingStats {
  stage: string;
  progress: number;
}

interface BatchQueueItem {
  id: string;
  file: File;
  originalUrl: string;
  resultUrl: string | null;
  status: 'pending' | 'processing' | 'done' | 'error';
}

const compositeToBlob = async (
  resultUrl: string,
  bgImageUrl: string | null,
  bgColor: string
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const resultImg = new window.Image();
    resultImg.crossOrigin = "anonymous";
    resultImg.onload = () => {
      const width = resultImg.width;
      const height = resultImg.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("No canvas context"));

      const drawResultAndResolve = () => {
        ctx.drawImage(resultImg, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Blob creation failed"));
        }, "image/png");
      };

      if (bgColor !== "transparent") {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);
      }

      if (bgImageUrl) {
        const bgImg = new window.Image();
        bgImg.crossOrigin = "anonymous";
        bgImg.onload = () => {
          const scale = Math.max(width / bgImg.width, height / bgImg.height);
          const drawW = bgImg.width * scale;
          const drawH = bgImg.height * scale;
          const x = (width - drawW) / 2;
          const y = (height - drawH) / 2;
          ctx.drawImage(bgImg, x, y, drawW, drawH);
          drawResultAndResolve();
        };
        bgImg.onerror = () => reject(new Error("Failed to load bg image"));
        bgImg.src = bgImageUrl;
      } else {
        drawResultAndResolve();
      }
    };
    resultImg.onerror = () => reject(new Error("Failed to load result image"));
    resultImg.src = resultUrl;
  });
};

export default function Home() {
  const [appState, setAppState] = useState<AppState>("upload");
  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [viewIndex, setViewIndex] = useState<number>(0);
  
  const [isDragging, setIsDragging] = useState(false);
  const [stats, setStats] = useState<ProcessingStats>({ stage: "Preparing...", progress: 0 });
  
  const [customBgColor, setCustomBgColor] = useState<string>("transparent");
  const [customBgImageUrl, setCustomBgImageUrl] = useState<string | null>(null);
  
  const [copyFeedback, setCopyFeedback] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // Use refs so cleanup never accidentally fires mid-processing due to stale closures
  const queueRef = useRef<BatchQueueItem[]>([]);
  const bgImageUrlRef = useRef<string | null>(null);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { bgImageUrlRef.current = customBgImageUrl; }, [customBgImageUrl]);

  // Only revoke URLs on true unmount
  useEffect(() => {
    return () => {
      queueRef.current.forEach(item => {
        URL.revokeObjectURL(item.originalUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      });
      if (bgImageUrlRef.current) URL.revokeObjectURL(bgImageUrlRef.current);
    };
  }, []);

  const processNextInQueue = useCallback(async () => {
    if (currentIndex >= queue.length) {
      if (queue.length > 0 && queue.some(q => q.status === 'done')) {
        setAppState("result");
        setViewIndex(queue.findIndex(q => q.status === 'done'));
      } else {
        setAppState("upload");
      }
      return;
    }

    const currentItem = queue[currentIndex];
    if (currentItem.status !== 'pending') {
      setCurrentIndex(prev => prev + 1);
      return;
    }

    setAppState("processing");
    setStats({ stage: "Initializing model...", progress: 0 });

    setQueue(prev => prev.map((item, idx) => 
      idx === currentIndex ? { ...item, status: 'processing' } : item
    ));

    try {
      const blob = await removeBackground(currentItem.file, {
        model: "isnet_quint8",
        progress: (key, current, total) => {
          let stageName = key;
          if (key.includes("fetch:model")) stageName = "Downloading AI Model...";
          else if (key.includes("fetch:inference")) stageName = "Loading inference engine...";
          else if (key.includes("compute:inference")) stageName = "Removing background...";
          
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setStats({ stage: stageName, progress: pct });
        }
      });

      const newResultUrl = URL.createObjectURL(blob);
      setQueue(prev => prev.map((item, idx) => 
        idx === currentIndex ? { ...item, status: 'done', resultUrl: newResultUrl } : item
      ));
      setCurrentIndex(prev => prev + 1);
      
    } catch (error) {
      console.error("Processing error:", error);
      setQueue(prev => prev.map((item, idx) => 
        idx === currentIndex ? { ...item, status: 'error' } : item
      ));
      setCurrentIndex(prev => prev + 1);
    }
  }, [currentIndex, queue]);

  useEffect(() => {
    if (appState === "processing" && currentIndex < queue.length && queue[currentIndex].status === 'pending') {
      processNextInQueue();
    } else if (appState === "processing" && currentIndex >= queue.length) {
      if (queue.some(q => q.status === 'done')) {
        setAppState("result");
        setViewIndex(0);
      } else {
        resetState();
      }
    }
  }, [currentIndex, appState, processNextInQueue, queue]);

  const handleFiles = (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(f => isValidImage(f));
    if (validFiles.length === 0) return;

    const newItems: BatchQueueItem[] = validFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      originalUrl: URL.createObjectURL(file),
      resultUrl: null,
      status: 'pending'
    }));

    setQueue(newItems);
    setCurrentIndex(0);
    setViewIndex(0);
    setAppState("processing");
    setCustomBgColor("transparent");
    if (customBgImageUrl) {
      URL.revokeObjectURL(customBgImageUrl);
      setCustomBgImageUrl(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  };

  const handleBgFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isValidImage(file)) {
      if (customBgImageUrl) URL.revokeObjectURL(customBgImageUrl);
      setCustomBgImageUrl(URL.createObjectURL(file));
      setCustomBgColor("transparent");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const isValidImage = (file: File) => {
    return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  };

  const resetState = () => {
    // Explicitly revoke all URLs before clearing state
    queue.forEach(item => {
      URL.revokeObjectURL(item.originalUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    if (customBgImageUrl) URL.revokeObjectURL(customBgImageUrl);
    setAppState("upload");
    setQueue([]);
    setCurrentIndex(0);
    setViewIndex(0);
    setStats({ stage: "Preparing...", progress: 0 });
    setCustomBgColor("transparent");
    setCustomBgImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (bgInputRef.current) bgInputRef.current.value = "";
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadResult = async (item: BatchQueueItem) => {
    if (!item.resultUrl) return;
    
    if (customBgImageUrl || customBgColor !== "transparent") {
      try {
        const blob = await compositeToBlob(item.resultUrl, customBgImageUrl, customBgColor);
        downloadBlob(blob, `clearcut-${item.file.name.replace(/\.[^/.]+$/, "")}.png`);
      } catch (err) {
        console.error(err);
        alert("Failed to compose background for download.");
      }
    } else {
      const res = await fetch(item.resultUrl);
      const blob = await res.blob();
      downloadBlob(blob, `clearcut-${item.file.name.replace(/\.[^/.]+$/, "")}.png`);
    }
  };

  const downloadAll = async () => {
    const doneItems = queue.filter(q => q.status === 'done');
    if (doneItems.length === 0) return;

    if (doneItems.length === 1) {
      return downloadResult(doneItems[0]);
    }

    const zip = new JSZip();
    
    for (const item of doneItems) {
      if (!item.resultUrl) continue;
      let blob: Blob;
      if (customBgImageUrl || customBgColor !== "transparent") {
        blob = await compositeToBlob(item.resultUrl, customBgImageUrl, customBgColor);
      } else {
        const res = await fetch(item.resultUrl);
        blob = await res.blob();
      }
      zip.file(`clearcut-${item.file.name.replace(/\.[^/.]+$/, "")}.png`, blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "clearcut-batch.zip");
  };

  const copyToClipboard = async (item: BatchQueueItem) => {
    if (!item.resultUrl) return;
    try {
      let blob: Blob;
      if (customBgImageUrl || customBgColor !== "transparent") {
        blob = await compositeToBlob(item.resultUrl, customBgImageUrl, customBgColor);
      } else {
        const res = await fetch(item.resultUrl);
        blob = await res.blob();
      }
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch (err) {
      console.error(err);
      alert("Failed to copy image to clipboard.");
    }
  };

  const presetColors = [
    "transparent", "#ffffff", "#000000", 
    "#f87171", "#fb923c", "#fbbf24", "#fcd34d", 
    "#a3e635", "#4ade80", "#34d399", "#2dd4bf", 
    "#38bdf8", "#22d3ee", "#60a5fa", "#818cf8",
    "#a78bfa", "#c084fc", "#e879f9", "#f472b6", "#fb7185"
  ];

  const currentViewItem = queue[viewIndex];

  const backgroundStyle: React.CSSProperties = customBgImageUrl
    ? { backgroundImage: "url(" + customBgImageUrl + ")", backgroundSize: "cover", backgroundPosition: "center" }
    : { backgroundColor: customBgColor };

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20 selection:text-primary">
      <header className="h-16 flex items-center px-6 lg:px-12 border-b bg-card z-10 sticky top-0">
        <div className="flex items-center gap-2 font-semibold text-xl tracking-tight text-foreground">
          <Wand2 className="w-5 h-5 text-primary" />
          ClearCut
        </div>
        <div className="ml-auto text-sm text-muted-foreground flex items-center gap-4 hidden sm:flex">
          <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> 100% Local</span>
          <span className="flex items-center gap-1.5"><Zap className="w-4 h-4" /> Fast & Free</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 w-full max-w-5xl mx-auto">
        <div className="w-full flex flex-col items-center">
          
          {appState === "upload" && (
            <div className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center mb-8">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground mb-4">
                  Drop the background. <br/><span className="text-primary">Keep the focus.</span>
                </h1>
                <p className="text-lg text-muted-foreground max-w-lg mx-auto">
                  Instantly remove image backgrounds in your browser. No uploads, no accounts, totally free.
                </p>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={cn(
                  "relative group cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed transition-all duration-300 ease-out bg-card w-full flex flex-col items-center justify-center p-12 sm:p-20",
                  isDragging ? "border-primary bg-primary/5 scale-[1.02] shadow-xl" : "border-border hover:border-primary/50 hover:bg-accent/50 shadow-sm hover:shadow-md"
                )}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className={cn("p-4 rounded-full bg-primary/10 text-primary mb-6 transition-transform duration-300", isDragging ? "scale-110" : "group-hover:scale-110 group-hover:-translate-y-1")}>
                  <UploadCloud className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-semibold mb-2 text-foreground">Click or drop images here</h3>
                <p className="text-sm text-muted-foreground mb-6 text-center">Supports multiple JPEG, PNG, WEBP</p>
                <Button size="lg" className="rounded-full pointer-events-none px-8">
                  Browse Files
                </Button>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/jpeg,image/png,image/webp"
                />
              </div>
            </div>
          )}

          {appState === "processing" && queue[currentIndex] && (
            <div className="w-full max-w-md animate-in zoom-in-95 fade-in duration-300">
              <div className="bg-card border rounded-3xl p-10 flex flex-col items-center text-center shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-pulse" />
                
                <div className="relative w-32 h-32 mb-8">
                  <div className="absolute inset-0 bg-primary/10 rounded-2xl animate-pulse" />
                  <img src={queue[currentIndex].originalUrl} alt="Processing" className="w-full h-full object-cover rounded-2xl shadow-sm opacity-50" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 bg-background/80 backdrop-blur rounded-full flex items-center justify-center shadow-sm animate-spin-slow">
                      <RefreshCw className="w-5 h-5 text-primary" />
                    </div>
                  </div>
                </div>
                
                <h2 className="text-xl font-semibold mb-2 text-foreground">
                  Processing {queue.length > 1 ? `(${currentIndex + 1} of ${queue.length})` : 'Image'}
                </h2>
                <p className="text-sm text-muted-foreground mb-8 min-h-[1.5rem] font-medium">{stats.stage}</p>
                
                <div className="w-full space-y-2">
                  <Progress value={stats.progress} className="h-2.5 w-full bg-accent" />
                  <div className="flex justify-between text-xs text-muted-foreground font-mono">
                    <span>{stats.progress}%</span>
                    <span>100%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {appState === "result" && currentViewItem?.resultUrl && (
            <div className="w-full max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
              
              <CompareSlider 
                originalUrl={currentViewItem.originalUrl} 
                resultUrl={currentViewItem.resultUrl} 
                backgroundStyle={backgroundStyle}
              />

              {queue.length > 1 && (
                <div className="bg-card border rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground">Batch Queue</h3>
                    <span className="text-xs text-muted-foreground">
                      {queue.filter(q => q.status === 'done').length} of {queue.length} done
                    </span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                    {queue.map((item, idx) => (
                      <button
                        key={item.id}
                        onClick={() => item.status === 'done' && setViewIndex(idx)}
                        disabled={item.status !== 'done'}
                        className={cn(
                          "relative flex-shrink-0 flex flex-col items-center gap-1 w-16 transition-all",
                          viewIndex === idx ? "opacity-100" : "opacity-60 hover:opacity-100",
                          item.status !== 'done' && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        <div className={cn(
                          "w-16 h-16 rounded-xl overflow-hidden border-2 relative",
                          viewIndex === idx ? "border-primary shadow-sm" : "border-border"
                        )}>
                          <img src={item.originalUrl} className="w-full h-full object-cover" alt="thumbnail" />
                          {item.status === 'done' && (
                            <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                              <CheckCircle2 className="w-6 h-6 text-green-400 fill-black/50" />
                            </div>
                          )}
                          {item.status === 'error' && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <XCircle className="w-6 h-6 text-red-500 fill-white" />
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                          {item.file.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-card border rounded-3xl p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                  
                  <div className="flex-1 w-full flex flex-col gap-3">
                    <span className="text-sm font-medium text-muted-foreground">Background</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => bgInputRef.current?.click()}
                        className={cn(
                          "flex items-center justify-center w-8 h-8 rounded-full border border-dashed shadow-sm transition-transform hover:scale-110 bg-accent text-accent-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                          customBgImageUrl && "ring-2 ring-primary ring-offset-2 scale-110 border-solid"
                        )}
                        title="Upload Background Image"
                      >
                        {customBgImageUrl ? (
                          <img src={customBgImageUrl} className="w-full h-full rounded-full object-cover" alt="bg" />
                        ) : (
                          <ImagePlus className="w-4 h-4" />
                        )}
                      </button>
                      <input
                        type="file"
                        className="hidden"
                        ref={bgInputRef}
                        onChange={handleBgFileSelect}
                        accept="image/jpeg,image/png,image/webp"
                      />

                      <div className="w-px h-6 bg-border mx-1" />

                      {presetColors.map(color => (
                        <button
                          key={color}
                          onClick={() => {
                            setCustomBgColor(color);
                            setCustomBgImageUrl(null);
                          }}
                          className={cn(
                            "w-8 h-8 rounded-full border shadow-sm transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                            customBgColor === color && !customBgImageUrl && "ring-2 ring-primary ring-offset-2 scale-110",
                            color === "transparent" && "bg-checkerboard bg-[length:10px_10px]"
                          )}
                          style={color !== "transparent" ? { backgroundColor: color } : undefined}
                          title={color === "transparent" ? "Transparent" : color}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <Button variant="outline" size="lg" onClick={resetState} className="flex-1 sm:flex-none rounded-xl">
                      <RefreshCw className="w-4 h-4 mr-2" /> Start Over
                    </Button>
                    
                    <div className="relative">
                      <Button variant="outline" size="lg" onClick={() => copyToClipboard(currentViewItem)} className="flex-1 sm:flex-none rounded-xl">
                        <Clipboard className="w-4 h-4 mr-2" /> Copy
                      </Button>
                      {copyFeedback && (
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-white text-xs py-1.5 px-3 rounded-lg shadow-lg pointer-events-none animate-in fade-in slide-in-from-bottom-2">
                          Copied!
                        </div>
                      )}
                    </div>

                    <Button size="lg" onClick={queue.length > 1 ? downloadAll : () => downloadResult(currentViewItem)} className="flex-1 sm:flex-none rounded-xl shadow-md bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8">
                      <Download className="w-4 h-4 mr-2" /> {queue.length > 1 ? "Download All (ZIP)" : "Download"}
                    </Button>
                  </div>
                  
                </div>
              </div>
              
            </div>
          )}

        </div>
      </main>
      
      <footer className="py-6 text-center text-sm text-muted-foreground">
        <p>Processing happens entirely on your device. Your images are never uploaded to any server.</p>
      </footer>
    </div>
  );
}
