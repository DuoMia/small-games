import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Download,
  RotateCcw,
  LogOut,
  Pencil,
  Eraser,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import {
  DrawingCanvas,
  type Stroke,
} from "@/components/DrawingCanvas";
import type { CoOpStroke } from "@/lib/types";

// 笔画点同步节流间隔（毫秒）
const POINT_THROTTLE_MS = 50;
// 画布逻辑尺寸（与 DrawingCanvas 内部一致，始终保持 4:3 坐标系）
const CANVAS_W = 600;
const CANVAS_H = 450;
// 截图导出尺寸
const EXPORT_W = 400;
const EXPORT_H = 300;

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

/** 将笔画列表渲染到临时 canvas 并返回 DataURL（用于展示、下载和 AI 评分） */
function strokesToDataURL(
  strokes: CoOpStroke[],
  type: string = "image/png",
  quality?: number
): string {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_W;
  canvas.height = EXPORT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
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
    ctx.moveTo((first.x / CANVAS_W) * EXPORT_W, (first.y / CANVAS_H) * EXPORT_H);
    if (stroke.points.length === 1) {
      ctx.arc(
        (first.x / CANVAS_W) * EXPORT_W,
        (first.y / CANVAS_H) * EXPORT_H,
        stroke.size / 2,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = stroke.color;
      ctx.fill();
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(
          (stroke.points[i].x / CANVAS_W) * EXPORT_W,
          (stroke.points[i].y / CANVAS_H) * EXPORT_H
        );
      }
      ctx.stroke();
    }
    ctx.restore();
  });
  return canvas.toDataURL(type, quality);
}

export default function CoOpDrawing({ roomId }: { roomId: string }) {
  const { phase } = useGameStore();
  // 根据阶段分发
  if (phase === "GAME_OVER") return <CoOpResult roomId={roomId} />;
  if (phase === "ROUND_RESULT") return <CoOpAIJudging roomId={roomId} />;
  return <CoOpPlaying roomId={roomId} />;
}

// ============ 画画阶段（DRAWING）：双方同时画 ============
function CoOpPlaying({ roomId }: { roomId: string }) {
  const {
    coOpPrompt,
    coOpTimeLeft,
    coOpOrientation,
    coOpIncomingStroke,
    coOpStrokes,
    myId,
  } = useGameStore();
  const { coOpStrokeStart, coOpStrokePoint, coOpStrokeEnd } = useRoomActions();
  const { sfxEnabled } = useAudioStore();

  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  const [color, setColor] = useState(COLORS[0].value);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1].value);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");

  // 我正在画的笔画引用（DrawingCanvas 内部会 push points 到同一对象）
  const myCurrentStrokeRef = useRef<Stroke | null>(null);
  // 上次发送 point 的时间戳（节流）
  const lastPointEmitRef = useRef<number>(0);

  // 拼装展示用笔画：已完成 + 对方正在画的（若有）
  const displayStrokes: Stroke[] = useMemo(() => {
    const base: Stroke[] = coOpStrokes.map((s) => ({
      color: s.color,
      size: s.size,
      isEraser: s.isEraser,
      points: s.points,
    }));
    if (coOpIncomingStroke) {
      base.push({
        color: coOpIncomingStroke.color,
        size: coOpIncomingStroke.size,
        isEraser: coOpIncomingStroke.isEraser,
        points: coOpIncomingStroke.points,
      });
    }
    return base;
  }, [coOpStrokes, coOpIncomingStroke]);

  // 笔画开始：记录引用并通知服务器
  const handleStrokeStart = useCallback(
    (stroke: Stroke) => {
      myCurrentStrokeRef.current = stroke;
      coOpStrokeStart(roomId, {
        color: stroke.color,
        size: stroke.size,
        isEraser: stroke.isEraser,
        points: stroke.points,
      });
    },
    [roomId, coOpStrokeStart]
  );

  // 笔画进行中：节流发送点
  const handleStrokePoint = useCallback(
    (point: { x: number; y: number }) => {
      const now = Date.now();
      if (now - lastPointEmitRef.current >= POINT_THROTTLE_MS) {
        lastPointEmitRef.current = now;
        coOpStrokePoint(roomId, point);
      }
    },
    [roomId, coOpStrokePoint]
  );

  // 笔画结束：本地追加 + 通知服务器（携带完整笔画）
  const handleStrokeEnd = useCallback(() => {
    if (
      myCurrentStrokeRef.current &&
      myCurrentStrokeRef.current.points.length > 0
    ) {
      const completedStroke: CoOpStroke = {
        ...myCurrentStrokeRef.current,
        author: myId ?? "",
      };
      useGameStore.getState().appendCoOpStroke(completedStroke);
      coOpStrokeEnd(roomId, completedStroke);
    }
    myCurrentStrokeRef.current = null;
  }, [roomId, coOpStrokeEnd, myId]);

  // 画布容器宽高比：横屏 4:3，竖屏 3:4
  const aspectClass = coOpOrientation === "portrait" ? "aspect-[3/4]" : "aspect-[4/3]";
  // 竖屏时画布最大高度受限，横屏时最大宽度受限
  const containerClass =
    coOpOrientation === "portrait"
      ? "w-full max-w-[280px]"
      : "w-full max-w-md";

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏：命题 + 倒计时 */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-ink-muted">命题</span>
          <span className="text-xs text-ink-muted">
            {coOpOrientation === "portrait" ? "竖屏画" : "横屏画"} · 同时画
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="bg-sun text-ink font-display text-base px-3 py-1 rounded-full border-2 border-ink truncate">
            {coOpPrompt?.prompt || "加载中..."}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="font-display text-sm text-coral">两人同画</span>
            <span
              className={`font-display text-xl ${
                coOpTimeLeft <= 10 ? "text-coral animate-pulse" : "text-ink"
              }`}
            >
              {coOpTimeLeft}s
            </span>
          </div>
        </div>
      </div>

      {/* 主区域：画布（双方同时可画） */}
      <div className="flex-1 flex flex-col px-3 py-2 min-h-0">
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div
            className={`${containerClass} ${aspectClass} bg-white rounded-doodle border-3 border-ink shadow-card overflow-hidden relative`}
          >
            <DrawingCanvas
              strokes={displayStrokes}
              onStrokesChange={() => {}}
              color={color}
              brushSize={brushSize}
              tool={tool}
              disabled={false}
              onStrokeStart={handleStrokeStart}
              onStrokePoint={handleStrokePoint}
              onStrokeEnd={handleStrokeEnd}
            />
          </div>
        </div>
        {/* 横屏模式下提示手机横放 */}
        {coOpOrientation === "landscape" && (
          <p className="text-center text-[10px] text-ink-muted mt-1">
            💡 横屏画作建议横放手机
          </p>
        )}
      </div>

      {/* 工具栏（两人都能用） */}
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
    </div>
  );
}

// ============ AI 评分阶段（ROUND_RESULT） ============
function CoOpAIJudging({ roomId }: { roomId: string }) {
  const { coOpStrokes, coOpIncomingStroke, coOpPrompt, myId, room } = useGameStore();
  const { coOpSubmitDrawing } = useRoomActions();
  const submittedRef = useRef(false);

  // 房主负责渲染画作并提交给后端 AI 评分
  useEffect(() => {
    if (submittedRef.current) return;
    const isHost = room?.hostId === myId;
    if (!isHost) return;
    submittedRef.current = true;
    // 合并已完成笔画和对方进行中的笔画（若有）
    const allStrokes: CoOpStroke[] = [...coOpStrokes];
    if (coOpIncomingStroke && coOpIncomingStroke.points.length > 0) {
      allStrokes.push(coOpIncomingStroke);
    }
    // 渲染为 JPEG data URL 提交给 AI
    const imageDataURL = strokesToDataURL(allStrokes, "image/jpeg", 0.7);
    if (imageDataURL && roomId) {
      coOpSubmitDrawing(roomId, imageDataURL);
    }
  }, [coOpStrokes, coOpIncomingStroke, myId, room, roomId, coOpSubmitDrawing]);

  return (
    <div className="paper-bg h-[100dvh] flex flex-col items-center justify-center px-5">
      <div className="text-center animate-bounce-in">
        <div className="text-5xl mb-4 animate-float">🤖</div>
        <Loader2 size={40} className="animate-spin text-coral mx-auto mb-4" />
        <h1 className="font-display text-2xl text-ink mb-2">AI 正在评分...</h1>
        <p className="text-ink-muted text-sm">
          正在欣赏你们合作的「{coOpPrompt?.prompt ?? ""}」
        </p>
        <div className="flex items-center justify-center gap-1 mt-4">
          <Sparkles size={16} className="text-sun" />
          <span className="text-xs text-ink-muted">请稍候</span>
          <Sparkles size={16} className="text-sun" />
        </div>
      </div>
    </div>
  );
}

// ============ 结果页（GAME_OVER） ============
function CoOpResult({ roomId }: { roomId: string }) {
  const { coOpStrokes, coOpIncomingStroke, coOpResult, coOpPrompt, myId, room } =
    useGameStore();
  const { coOpRestart, leaveRoom } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };
  const isHost = room?.hostId === myId;

  // 渲染最终画作为图片（合并对方进行中的笔画）
  const finalImage = useMemo(() => {
    try {
      const allStrokes: CoOpStroke[] = [...coOpStrokes];
      if (coOpIncomingStroke && coOpIncomingStroke.points.length > 0) {
        allStrokes.push(coOpIncomingStroke);
      }
      return strokesToDataURL(allStrokes);
    } catch {
      return "";
    }
  }, [coOpStrokes, coOpIncomingStroke]);

  if (!coOpResult) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-coral" />
      </div>
    );
  }

  const handleDownload = () => {
    playSfx(sfx.click);
    if (!finalImage) return;
    const a = document.createElement("a");
    a.href = finalImage;
    a.download = `合作画画_${coOpPrompt?.prompt ?? "作品"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleRestart = () => {
    playSfx(sfx.click);
    coOpRestart(roomId);
  };

  const handleLeave = () => {
    playSfx(sfx.click);
    leaveRoom(roomId);
    navigate("/");
  };

  const aiScore = coOpResult?.aiScore ?? 0;
  const aiComment = coOpResult?.aiComment ?? "";

  // 根据分数选色与文案
  const scoreColor =
    aiScore >= 8 ? "text-mint" : aiScore >= 5 ? "text-sun" : "text-coral";
  const scoreLabel =
    aiScore >= 8 ? "神作！" : aiScore >= 6 ? "不错！" : aiScore >= 4 ? "还行" : "加油";

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-4 animate-bounce-in">
          <div className="text-5xl mb-2 animate-float">🎨</div>
          <h1 className="font-display text-3xl text-ink">大作诞生！</h1>
          <p className="text-ink-muted text-sm mt-1">
            命题：{coOpPrompt?.prompt ?? ""}
          </p>
        </div>

        {/* 画作展示 */}
        <div className="bg-white rounded-doodle border-3 border-ink shadow-card p-2 mb-4">
          {finalImage ? (
            <img
              src={finalImage}
              alt="合作画作"
              className="w-full rounded-doodle bg-white"
              style={{ aspectRatio: "4 / 3" }}
            />
          ) : (
            <div className="w-full aspect-[4/3] bg-white rounded-doodle flex items-center justify-center">
              <Loader2 size={28} className="animate-spin text-ink-muted" />
            </div>
          )}
        </div>

        {/* AI 评分展示 */}
        <div className="bg-white rounded-blob border-2 border-ink shadow-soft p-4 mb-4 text-center">
          <p className="text-xs text-ink-muted mb-1 flex items-center justify-center gap-1">
            <Sparkles size={14} className="text-sun" />
            AI 评分
          </p>
          <div className="flex items-baseline justify-center mb-1">
            <span className={`font-display text-6xl ${scoreColor}`}>
              {aiScore}
            </span>
            <span className="font-display text-2xl text-ink-muted">/10</span>
          </div>
          <p className={`font-display text-lg ${scoreColor} mb-2`}>
            {scoreLabel}
          </p>
          <p className="text-sm text-ink-muted italic">"{aiComment}"</p>
        </div>

        {/* 操作按钮 */}
        <div className="space-y-3">
          <button
            onClick={handleDownload}
            className="btn-press w-full py-3 bg-mint text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
          >
            <Download size={20} />
            下载画作
          </button>
          {isHost ? (
            <button
              onClick={handleRestart}
              className="btn-press w-full py-3 bg-coral text-white font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
            >
              <RotateCcw size={20} />
              再玩一局
            </button>
          ) : (
            <div className="text-center py-2 text-ink-muted text-sm">
              等待房主决定是否再玩一局...
            </div>
          )}
          <button
            onClick={handleLeave}
            className="btn-press w-full py-3 bg-white text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
          >
            <LogOut size={20} />
            退出房间
          </button>
        </div>
      </div>
    </div>
  );
}
