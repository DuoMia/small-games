import { useState, useRef, useCallback, useEffect } from "react";
import {
  Undo2,
  Trash2,
  Eraser,
  Pencil,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import {
  DrawingCanvas,
  type DrawingCanvasHandle,
  type Stroke,
} from "@/components/DrawingCanvas";

const TOTAL_PAGES = 30;
const VIEW_TIME = 5; // 看词5秒
const DRAW_TIME = 5; // 画图5秒
const CANVAS_W = 600;
const CANVAS_H = 450;

const COLORS = [
  { name: "ink", value: "#1B1340" },
  { name: "coral", value: "#FF5E5B" },
  { name: "blue", value: "#3B82F6" },
  { name: "green", value: "#3DDC97" },
  { name: "yellow", value: "#FFD23F" },
];

const BRUSH_SIZES = [
  { name: "细", value: 3 },
  { name: "中", value: 6 },
  { name: "粗", value: 12 },
];

/** 将笔画渲染到临时 canvas 并返回 DataURL */
function strokesToDataURL(strokes: Stroke[]): string {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokes.forEach((stroke) => {
    if (stroke.points.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = stroke.isEraser
      ? "destination-out"
      : "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    const first = stroke.points[0];
    ctx.moveTo(first.x, first.y);
    if (stroke.points.length === 1) {
      ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.color;
      ctx.fill();
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  });
  return canvas.toDataURL("image/jpeg", 0.7);
}

type Mode = "view" | "draw" | "done";

export default function DrawingPhase({ roomId }: { roomId: string }) {
  const { words, currentRound, setDrawings } = useGameStore();
  const { uploadDrawings } = useRoomActions();
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("view");
  const [timeLeft, setTimeLeft] = useState(VIEW_TIME);
  const [pages, setPages] = useState<Stroke[][]>(() =>
    Array.from({ length: TOTAL_PAGES }, () => [])
  );
  const [color, setColor] = useState(COLORS[0].value);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1].value);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [showWarning, setShowWarning] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // 倒计时驱动 view → draw → next
  useEffect(() => {
    if (mode === "done") return;
    const start = Date.now();
    const duration = mode === "view" ? VIEW_TIME : DRAW_TIME;
    setTimeLeft(duration);
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, duration - elapsed);
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(interval);
        if (mode === "view") {
          setMode("draw");
        } else {
          // draw 结束，保存当前画布并进入下一个词
          const currentStrokes = canvasRef.current?.getStrokes() ?? [];
          setPages((prev) => {
            const next = [...prev];
            next[currentIndex] = currentStrokes;
            return next;
          });
          if (currentIndex + 1 >= TOTAL_PAGES) {
            setMode("done");
          } else {
            setCurrentIndex((i) => i + 1);
            setMode("view");
          }
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [mode, currentIndex]);

  // 所有词画完 → 自动提交
  useEffect(() => {
    if (mode !== "done" || submitted) return;
    setSubmitted(true);
    const dataURLs = pagesRef.current.map((strokes) => strokesToDataURL(strokes));
    setDrawings(dataURLs);
    uploadDrawings(roomId, dataURLs);
  }, [mode, submitted, roomId, uploadDrawings, setDrawings]);

  const handleStrokesChange = useCallback(
    (strokes: Stroke[]) => {
      setPages((prev) => {
        const next = [...prev];
        next[currentIndex] = strokes;
        return next;
      });
    },
    [currentIndex]
  );

  // 玩家手动提前完成画图（跳过当前词的剩余画图时间）
  const handleSkip = useCallback(() => {
    if (mode !== "draw") return;
    const currentStrokes = canvasRef.current?.getStrokes() ?? [];
    setPages((prev) => {
      const next = [...prev];
      next[currentIndex] = currentStrokes;
      return next;
    });
    if (currentIndex + 1 >= TOTAL_PAGES) {
      setMode("done");
    } else {
      setCurrentIndex((i) => i + 1);
      setMode("view");
    }
  }, [mode, currentIndex]);

  const drawnCount = pages.filter((p) => p.length > 0).length;
  const isView = mode === "view";
  const isDraw = mode === "draw";

  return (
    <div className="paper-bg min-h-screen flex flex-col">
      {/* 顶栏 */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2">
          <span className="font-display text-ink text-sm">第 {currentRound} 轮</span>
          <span className="text-ink-muted text-xs">
            · {isView ? "看词" : isDraw ? "画图" : "完成"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-display text-ink text-sm">
            {currentIndex + 1}/{TOTAL_PAGES}
          </span>
          <span
            className={`font-display text-lg ${
              timeLeft <= 3 ? "text-coral animate-pulse" : "text-ink"
            }`}
          >
            {Math.ceil(timeLeft)}s
          </span>
        </div>
        {isDraw && (
          <button
            onClick={handleSkip}
            className="btn-press flex items-center gap-1 bg-mint text-ink font-display text-sm px-3 py-1.5 rounded-doodle border-2 border-ink shadow-soft"
          >
            <Check size={14} />
            画好了
          </button>
        )}
      </div>

      {/* 文字违规警告 */}
      {showWarning && isView && currentIndex === 0 && (
        <div className="px-4 py-2 bg-warn/20 border-b-2 border-warn/30 flex items-center gap-2 animate-slide-up">
          <AlertTriangle size={18} className="text-warn flex-shrink-0" />
          <p className="text-xs text-ink flex-1">
            <strong>注意：</strong>画作中不能出现任何文字！用图画来表达词语。
          </p>
          <button
            onClick={() => setShowWarning(false)}
            className="text-ink-muted text-xs flex-shrink-0"
          >
            知道了
          </button>
        </div>
      )}

      {/* 主区域 */}
      <div className="flex-1 flex flex-col px-3 py-2 min-h-0">
        {isView && (
          /* 看词模式 */
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="font-body text-ink-muted text-sm mb-4">
              记住这个词，等下凭记忆画出来
            </p>
            <div className="bg-white rounded-blob border-3 border-ink shadow-card px-12 py-8 animate-bounce-in">
              <span className="font-display text-6xl text-ink">
                {words[currentIndex] || ""}
              </span>
            </div>
            {/* 倒计时圆点 */}
            <div className="flex items-center gap-1.5 mt-6">
              {Array.from({ length: VIEW_TIME }, (_, i) => (
                <div
                  key={i}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    i < Math.ceil(timeLeft) ? "bg-coral" : "bg-cream-dark"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {isDraw && (
          /* 画图模式 */
          <>
            <div className="flex items-center justify-between mb-1.5">
              <span className="bg-sun text-ink font-display text-sm px-2.5 py-0.5 rounded-full border-2 border-ink">
                #{currentIndex + 1}
              </span>
              <span className="text-xs text-ink-muted">
                已画 {drawnCount}/{TOTAL_PAGES}
              </span>
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <div className="w-full max-w-md aspect-[4/3] bg-white rounded-doodle border-3 border-ink shadow-card overflow-hidden relative">
                <DrawingCanvas
                  key={currentIndex}
                  ref={canvasRef}
                  strokes={pages[currentIndex] || []}
                  onStrokesChange={handleStrokesChange}
                  color={color}
                  brushSize={brushSize}
                  tool={tool}
                />
              </div>
            </div>
          </>
        )}

        {mode === "done" && !submitted && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-3 animate-float">📝</div>
              <p className="font-display text-2xl text-ink">正在提交画作...</p>
            </div>
          </div>
        )}
      </div>

      {/* 工具栏（仅画图模式） */}
      {isDraw && (
        <div className="bg-white border-t-2 border-ink px-3 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => {
                    setColor(c.value);
                    setTool("pen");
                  }}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    color === c.value && tool === "pen"
                      ? "border-ink scale-125 ring-2 ring-sun"
                      : "border-ink/30"
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setTool(tool === "pen" ? "eraser" : "pen")}
                className={`btn-press p-2 rounded-doodle border-2 ${
                  tool === "eraser"
                    ? "bg-warn text-white border-ink"
                    : "bg-white text-ink border-ink"
                }`}
              >
                {tool === "eraser" ? <Eraser size={18} /> : <Pencil size={18} />}
              </button>
              <button
                onClick={() => canvasRef.current?.undo()}
                className="btn-press p-2 rounded-doodle border-2 border-ink bg-white text-ink"
              >
                <Undo2 size={18} />
              </button>
              <button
                onClick={() => canvasRef.current?.clear()}
                className="btn-press p-2 rounded-doodle border-2 border-ink bg-white text-coral"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted font-body">粗细</span>
            {BRUSH_SIZES.map((b) => (
              <button
                key={b.value}
                onClick={() => setBrushSize(b.value)}
                className={`flex-1 py-1.5 rounded-doodle border-2 font-display text-sm transition-all ${
                  brushSize === b.value
                    ? "bg-ink text-cream border-ink"
                    : "bg-white text-ink border-ink/30"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 提交后等待遮罩 */}
      {submitted && (
        <div className="fixed inset-0 bg-ink/60 z-50 flex items-center justify-center px-8">
          <div className="bg-white rounded-blob border-3 border-ink shadow-card p-8 text-center max-w-xs animate-bounce-in">
            <div className="text-5xl mb-3 animate-float">⏳</div>
            <h3 className="font-display text-2xl text-ink mb-1">画作已提交！</h3>
            <p className="text-ink-muted text-sm">
              等待对手完成画画，准备进入答题阶段...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
