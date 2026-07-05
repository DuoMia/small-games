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
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import {
  DrawingCanvas,
  type DrawingCanvasHandle,
  type Stroke,
} from "@/components/DrawingCanvas";
import { hasTextSuspicion } from "@/utils/textDetect";

// 默认值（与 normal 难度保持一致），等待后端 game:config 下发后更新
const DEFAULT_VIEW_TIME = 3;
const DEFAULT_DRAW_TIME = 8;
const DEFAULT_TOTAL_PAGES = 30;
// 降低分辨率以减少 toDataURL 开销
const CANVAS_W = 400;
const CANVAS_H = 300;

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

/** 将笔画渲染到临时 canvas 并返回 DataURL（单张，同步） */
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
    // 坐标缩放：DrawingCanvas 是 600x450 逻辑坐标，目标是 400x300
    ctx.moveTo((first.x / 600) * CANVAS_W, (first.y / 450) * CANVAS_H);
    if (stroke.points.length === 1) {
      ctx.arc(
        (first.x / 600) * CANVAS_W,
        (first.y / 450) * CANVAS_H,
        stroke.size / 2,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = stroke.color;
      ctx.fill();
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(
          (stroke.points[i].x / 600) * CANVAS_W,
          (stroke.points[i].y / 450) * CANVAS_H
        );
      }
      ctx.stroke();
    }
    ctx.restore();
  });
  return canvas.toDataURL("image/jpeg", 0.5);
}

/** 异步分批将笔画转为 DataURL，避免阻塞主线程导致音乐卡顿 */
async function strokesBatchToDataURLs(strokesList: Stroke[][]): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < strokesList.length; i++) {
    results.push(strokesToDataURL(strokesList[i]));
    // 每处理 3 张让出主线程一次，让 BGM 调度和 UI 更新得以执行
    if (i % 3 === 2) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return results;
}

type Mode = "view" | "draw" | "done";

export default function DrawingPhase({ roomId }: { roomId: string }) {
  const { words, currentRound, setDrawings, gameConfig, room } = useGameStore();
  const { uploadDrawings } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  // 难度对应的时间/题量（后端 game:config 下发，未收到前用默认值）
  const viewTime = gameConfig?.viewTime ?? DEFAULT_VIEW_TIME;
  const drawTime = gameConfig?.drawTime ?? DEFAULT_DRAW_TIME;
  const totalPages = room?.wordsPerRound ?? DEFAULT_TOTAL_PAGES;

  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("view");
  const [timeLeft, setTimeLeft] = useState(viewTime);
  const [pages, setPages] = useState<Stroke[][]>(() =>
    Array.from({ length: totalPages }, () => [])
  );
  const [color, setColor] = useState(COLORS[0].value);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1].value);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [showWarning, setShowWarning] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [textAlert, setTextAlert] = useState<string | null>(null);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // 检测当前画布是否疑似含文字，若是则弹出提示
  const checkTextAlert = useCallback((strokes: Stroke[], idx: number) => {
    if (strokes.length > 0 && hasTextSuspicion(strokes)) {
      setTextAlert(`第 ${idx + 1} 张画疑似写了文字，请用图画表达！`);
      setTimeout(() => setTextAlert(null), 3000);
    }
  }, []);

  // 上一次的倒计时秒数（用于触发滴答音效）
  const lastSecRef = useRef<number>(-1);

  // 倒计时驱动 view → draw → next
  useEffect(() => {
    if (mode === "done") return;
    const start = Date.now();
    const duration = mode === "view" ? viewTime : drawTime;
    setTimeLeft(duration);
    lastSecRef.current = Math.ceil(duration);
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, duration - elapsed);
      setTimeLeft(left);
      // 滴答音效：每整秒触发
      const sec = Math.ceil(left);
      if (sec !== lastSecRef.current && sec > 0) {
        lastSecRef.current = sec;
        if (left <= 3 && left > 0) {
          playSfx(sfx.tickUrgent);
        } else {
          playSfx(sfx.tick);
        }
      }
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
          checkTextAlert(currentStrokes, currentIndex);
          if (currentIndex + 1 >= totalPages) {
            setMode("done");
          } else {
            setCurrentIndex((i) => i + 1);
            setMode("view");
          }
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [mode, currentIndex, checkTextAlert, viewTime, drawTime, totalPages, playSfx]);

  // 所有词画完 → 异步分批提交，避免阻塞主线程
  useEffect(() => {
    if (mode !== "done" || submitted || submitting) return;
    setSubmitting(true);
    setSubmitted(true);
    (async () => {
      const dataURLs = await strokesBatchToDataURLs(pagesRef.current);
      setDrawings(dataURLs);
      uploadDrawings(roomId, dataURLs);
      setSubmitting(false);
      playSfx(sfx.roundEnd);
    })();
  }, [mode, submitted, submitting, roomId, uploadDrawings, setDrawings, playSfx]);

  // 提交后超时兜底：如果 20s 后仍在 DRAWING 阶段，提示可重试
  const [waitTimeout, setWaitTimeout] = useState(false);
  useEffect(() => {
    if (!submitted) return;
    setWaitTimeout(false);
    const timer = setTimeout(() => {
      // 仍处于 DRAWING 且已提交，说明对手可能掉线
      const { phase } = useGameStore.getState();
      if (phase === "DRAWING") setWaitTimeout(true);
    }, 20000);
    return () => clearTimeout(timer);
  }, [submitted]);

  const handleRetryUpload = async () => {
    if (!submitted) return;
    setSubmitting(true);
    setWaitTimeout(false);
    const dataURLs = await strokesBatchToDataURLs(pagesRef.current);
    setDrawings(dataURLs);
    uploadDrawings(roomId, dataURLs);
    setSubmitting(false);
  };

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
    checkTextAlert(currentStrokes, currentIndex);
    if (currentIndex + 1 >= totalPages) {
      setMode("done");
    } else {
      setCurrentIndex((i) => i + 1);
      setMode("view");
    }
    playSfx(sfx.click);
  }, [mode, currentIndex, checkTextAlert, totalPages, playSfx]);

  const drawnCount = pages.filter((p) => p.length > 0).length;
  const isView = mode === "view";
  const isDraw = mode === "draw";

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-display text-ink text-sm">第 {currentRound} 轮</span>
          <span className="text-ink-muted text-xs">
            · {isView ? "看词" : isDraw ? "画图" : "完成"}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-display text-ink text-sm">
            {currentIndex + 1}/{totalPages}
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
            className="btn-press flex-shrink-0 flex items-center gap-1 bg-mint text-ink font-display text-sm px-3 py-1.5 rounded-doodle border-2 border-ink shadow-soft whitespace-nowrap"
          >
            <Check size={14} />
            画好了
          </button>
        )}
      </div>

      {/* 文字违规警告 */}
      {showWarning && isView && currentIndex === 0 && (
        <div className="flex-shrink-0 px-4 py-2 bg-warn/20 border-b-2 border-warn/30 flex items-center gap-2 animate-slide-up">
          <AlertTriangle size={18} className="text-warn flex-shrink-0" />
          <p className="text-xs text-ink flex-1">
            <strong>注意：</strong>画作中不能出现任何文字！用图画来表达词语。
          </p>
          <button
            onClick={() => {
              setShowWarning(false);
              playSfx(sfx.click);
            }}
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
            <div className="bg-white rounded-blob border-3 border-ink shadow-card px-8 py-6 animate-bounce-in">
              <span className="font-display text-4xl sm:text-5xl text-ink break-all">
                {words[currentIndex] || ""}
              </span>
            </div>
            {/* 倒计时圆点 */}
            <div className="flex items-center gap-1.5 mt-6">
              {Array.from({ length: viewTime }, (_, i) => (
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
                已画 {drawnCount}/{totalPages}
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
        <div className="flex-shrink-0 bg-white border-t-2 border-ink px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => {
                    setColor(c.value);
                    setTool("pen");
                    playSfx(sfx.uiTick);
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
                onClick={() => {
                  setTool(tool === "pen" ? "eraser" : "pen");
                  playSfx(sfx.uiTick);
                }}
                className={`btn-press p-2 rounded-doodle border-2 ${
                  tool === "eraser"
                    ? "bg-warn text-white border-ink"
                    : "bg-white text-ink border-ink"
                }`}
              >
                {tool === "eraser" ? <Eraser size={18} /> : <Pencil size={18} />}
              </button>
              <button
                onClick={() => {
                  canvasRef.current?.undo();
                  playSfx(sfx.click);
                }}
                className="btn-press p-2 rounded-doodle border-2 border-ink bg-white text-ink"
              >
                <Undo2 size={18} />
              </button>
              <button
                onClick={() => {
                  canvasRef.current?.clear();
                  playSfx(sfx.click);
                }}
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
                onClick={() => {
                  setBrushSize(b.value);
                  playSfx(sfx.uiTick);
                }}
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
            {submitting ? (
              <>
                <h3 className="font-display text-2xl text-ink mb-1">正在处理画作...</h3>
                <p className="text-ink-muted text-sm mt-2">
                  将画作转为图片中，请稍候
                </p>
              </>
            ) : waitTimeout ? (
              <>
                <h3 className="font-display text-2xl text-ink mb-1">画作已提交！</h3>
                <p className="text-coral text-sm mt-2 mb-4">
                  对手似乎掉线了，迟迟未提交
                </p>
                <button
                  onClick={handleRetryUpload}
                  className="btn-press w-full py-3 bg-coral text-white font-display rounded-doodle border-2 border-ink shadow-soft"
                >
                  重新提交
                </button>
              </>
            ) : (
              <>
                <h3 className="font-display text-2xl text-ink mb-1">画作已提交！</h3>
                <p className="text-ink-muted text-sm">
                  等待其余玩家完成绘画，准备进入答题阶段...
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* 文字检测提示 */}
      {textAlert && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-coral text-white px-4 py-2.5 rounded-doodle border-2 border-ink shadow-card flex items-center gap-2 animate-slide-up max-w-[90%]">
          <AlertTriangle size={18} className="flex-shrink-0" />
          <span className="font-body text-sm">{textAlert}</span>
        </div>
      )}
    </div>
  );
}
