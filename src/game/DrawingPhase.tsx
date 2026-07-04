import { useState, useRef, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
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
import CountdownTimer from "@/components/CountdownTimer";

const TOTAL_PAGES = 30;
const DRAWING_TIME = 300; // 5分钟
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

export default function DrawingPhase({ roomId }: { roomId: string }) {
  const { words, currentRound, setDrawings } = useGameStore();
  const { uploadDrawings } = useRoomActions();
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const [currentPage, setCurrentPage] = useState(0);
  const [pages, setPages] = useState<Stroke[][]>(() =>
    Array.from({ length: TOTAL_PAGES }, () => [])
  );
  const [color, setColor] = useState(COLORS[0].value);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1].value);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [showWarning, setShowWarning] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const handleStrokesChange = useCallback(
    (strokes: Stroke[]) => {
      setPages((prev) => {
        const next = [...prev];
        next[currentPage] = strokes;
        return next;
      });
    },
    [currentPage]
  );

  const goPrev = () => {
    if (currentPage > 0) setCurrentPage((p) => p - 1);
  };
  const goNext = () => {
    if (currentPage < TOTAL_PAGES - 1) setCurrentPage((p) => p + 1);
  };

  const handleSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    // 生成所有画作的 DataURL
    const dataURLs = pages.map((strokes) => strokesToDataURL(strokes));
    setDrawings(dataURLs);
    uploadDrawings(roomId, dataURLs);
  }, [pages, roomId, uploadDrawings, setDrawings, submitted]);

  const handleTimeUp = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  const drawnCount = pages.filter((p) => p.length > 0).length;

  return (
    <div className="paper-bg min-h-screen flex flex-col">
      {/* 顶栏 */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2">
          <span className="font-display text-ink text-sm">第 {currentRound} 轮</span>
          <span className="text-ink-muted text-xs">· 画画阶段</span>
        </div>
        <CountdownTimer duration={DRAWING_TIME} onEnd={handleTimeUp} size="sm" />
        <button
          onClick={handleSubmit}
          disabled={submitted}
          className="btn-press flex items-center gap-1 bg-mint text-ink font-display text-sm px-4 py-2 rounded-doodle border-2 border-ink shadow-soft disabled:opacity-50"
        >
          <Check size={16} />
          {submitted ? "已提交" : "完成画画"}
        </button>
      </div>

      {/* 文字违规警告 */}
      {showWarning && (
        <div className="px-4 py-2 bg-warn/20 border-b-2 border-warn/30 flex items-center gap-2 animate-slide-up">
          <AlertTriangle size={18} className="text-warn flex-shrink-0" />
          <p className="text-xs text-ink flex-1">
            <strong>注意：</strong>画作中不能出现任何文字！否则判定出局。用图画来表达词语。
          </p>
          <button
            onClick={() => setShowWarning(false)}
            className="text-ink-muted text-xs flex-shrink-0"
          >
            知道了
          </button>
        </div>
      )}

      {/* 画布区域 */}
      <div className="flex-1 flex flex-col px-3 py-2 min-h-0">
        {/* 序号标签 */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="bg-sun text-ink font-display text-sm px-2.5 py-0.5 rounded-full border-2 border-ink">
              #{currentPage + 1}
            </span>
            <span className="font-body text-ink text-sm">
              {words[currentPage] || ""}
            </span>
          </div>
          <span className="text-xs text-ink-muted">
            已画 {drawnCount}/{TOTAL_PAGES}
          </span>
        </div>

        {/* 画布 */}
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="w-full max-w-md aspect-[4/3] bg-white rounded-doodle border-3 border-ink shadow-card overflow-hidden relative">
            <DrawingCanvas
              ref={canvasRef}
              strokes={pages[currentPage]}
              onStrokesChange={handleStrokesChange}
              color={color}
              brushSize={brushSize}
              tool={tool}
            />
          </div>
        </div>

        {/* 翻页器 */}
        <div className="flex items-center justify-between py-2">
          <button
            onClick={goPrev}
            disabled={currentPage === 0}
            className="btn-press flex items-center gap-1 px-3 py-1.5 bg-white text-ink rounded-doodle border-2 border-ink disabled:opacity-30 text-sm font-display"
          >
            <ChevronLeft size={18} />
            上一个
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(TOTAL_PAGES, 30) }, (_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === currentPage
                    ? "bg-coral w-4"
                    : pages[i].length > 0
                    ? "bg-mint"
                    : "bg-cream-dark"
                }`}
              />
            )).slice(Math.max(0, currentPage - 5), currentPage + 5)}
          </div>
          <button
            onClick={goNext}
            disabled={currentPage === TOTAL_PAGES - 1}
            className="btn-press flex items-center gap-1 px-3 py-1.5 bg-white text-ink rounded-doodle border-2 border-ink disabled:opacity-30 text-sm font-display"
          >
            下一个
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="bg-white border-t-2 border-ink px-3 py-3 space-y-2">
        {/* 颜色选择 */}
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

          {/* 工具按钮 */}
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

        {/* 笔刷大小 */}
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
