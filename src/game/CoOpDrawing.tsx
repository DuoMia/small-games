import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Download,
  RotateCcw,
  LogOut,
  Pencil,
  Eraser,
  Check,
  Loader2,
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

// 每笔限时（秒）
const STROKE_TIME_LIMIT = 15;
// 笔画点同步节流间隔（毫秒）
const POINT_THROTTLE_MS = 50;
// 画布逻辑尺寸（与 DrawingCanvas 内部一致）
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

/** 将笔画列表渲染到临时 canvas 并返回 DataURL（用于展示和下载） */
function strokesToDataURL(strokes: CoOpStroke[]): string {
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
  return canvas.toDataURL("image/png");
}

/** 星级展示组件 */
function Stars({ rating, size = "text-2xl" }: { rating: number; size?: string }) {
  return (
    <div className={`flex items-center gap-0.5 ${size}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={n <= rating ? "text-sun" : "text-ink-muted/30"}
        >
          ★
        </span>
      ))}
    </div>
  );
}

export default function CoOpDrawing({ roomId }: { roomId: string }) {
  const { phase } = useGameStore();
  // 根据阶段分发
  if (phase === "GAME_OVER") return <CoOpResult roomId={roomId} />;
  if (phase === "ROUND_RESULT") return <CoOpRating roomId={roomId} />;
  return <CoOpPlaying roomId={roomId} />;
}

// ============ 画画阶段（DRAWING） ============
function CoOpPlaying({ roomId }: { roomId: string }) {
  const {
    coOpPrompt,
    coOpTurn,
    coOpIncomingStroke,
    coOpStrokes,
    myId,
    room,
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
  const [timeLeft, setTimeLeft] = useState(STROKE_TIME_LIMIT);

  // 我正在画的笔画引用（DrawingCanvas 内部会 push points 到同一对象）
  const myCurrentStrokeRef = useRef<Stroke | null>(null);
  // 上次发送 point 的时间戳（节流）
  const lastPointEmitRef = useRef<number>(0);
  // 上一次整秒（用于触发滴答音效）
  const lastSecRef = useRef<number>(STROKE_TIME_LIMIT);
  // 是否正在画（用于超时判断）
  const drawingRef = useRef<boolean>(false);
  // 本轮是否已超时自动结束（防止重复发送）
  const autoEndedRef = useRef<boolean>(false);

  const isMyTurn = !!coOpTurn && coOpTurn.currentPlayer === myId;
  const strokesLeft =
    coOpTurn?.strokesLeft ?? coOpPrompt?.totalStrokes ?? 20;
  const opponent = room?.players.find((p) => p.id !== myId);

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

  // 倒计时：轮次切换时重置为 15 秒
  useEffect(() => {
    setTimeLeft(STROKE_TIME_LIMIT);
    lastSecRef.current = STROKE_TIME_LIMIT;
    autoEndedRef.current = false;
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, STROKE_TIME_LIMIT - elapsed);
      setTimeLeft(left);
      // 滴答音效
      const sec = Math.ceil(left);
      if (sec !== lastSecRef.current && sec > 0) {
        lastSecRef.current = sec;
        if (left <= 3) playSfx(sfx.tickUrgent);
        else playSfx(sfx.tick);
      }
      // 超时：轮到我时自动结束当前笔画（或空过这一笔）
      if (left <= 0 && isMyTurn && !autoEndedRef.current) {
        autoEndedRef.current = true;
        if (drawingRef.current) {
          drawingRef.current = false;
          // 本地追加未完成的笔画
          if (
            myCurrentStrokeRef.current &&
            myCurrentStrokeRef.current.points.length > 0
          ) {
            useGameStore.getState().appendCoOpStroke({
              ...myCurrentStrokeRef.current,
              author: myId ?? "",
            });
          }
          myCurrentStrokeRef.current = null;
        }
        coOpStrokeEnd(roomId);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [
    coOpTurn?.currentPlayer,
    coOpTurn?.strokesLeft,
    isMyTurn,
    roomId,
    coOpStrokeEnd,
    playSfx,
    myId,
  ]);

  // 笔画开始：记录引用并通知服务器
  const handleStrokeStart = useCallback(
    (stroke: Stroke) => {
      drawingRef.current = true;
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

  // 笔画结束：本地追加 + 通知服务器
  const handleStrokeEnd = useCallback(() => {
    drawingRef.current = false;
    if (
      myCurrentStrokeRef.current &&
      myCurrentStrokeRef.current.points.length > 0
    ) {
      useGameStore.getState().appendCoOpStroke({
        ...myCurrentStrokeRef.current,
        author: myId ?? "",
      });
    }
    myCurrentStrokeRef.current = null;
    coOpStrokeEnd(roomId);
  }, [roomId, coOpStrokeEnd, myId]);

  const toolbarDisabled = !isMyTurn;

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏：命题 + 轮次 + 倒计时 */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-ink-muted">命题</span>
          <span className="text-xs text-ink-muted">剩余 {strokesLeft} 笔</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="bg-sun text-ink font-display text-base px-3 py-1 rounded-full border-2 border-ink truncate">
            {coOpPrompt?.prompt || "加载中..."}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`font-display text-sm ${
                isMyTurn ? "text-coral" : "text-ink-muted"
              }`}
            >
              {isMyTurn ? "轮到你" : `${opponent?.nickname ?? "对方"}画`}
            </span>
            <span
              className={`font-display text-xl ${
                timeLeft <= 3 ? "text-coral animate-pulse" : "text-ink"
              }`}
            >
              {Math.ceil(timeLeft)}s
            </span>
          </div>
        </div>
      </div>

      {/* 主区域：画布 */}
      <div className="flex-1 flex flex-col px-3 py-2 min-h-0">
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="w-full max-w-md aspect-[4/3] bg-white rounded-doodle border-3 border-ink shadow-card overflow-hidden relative">
            <DrawingCanvas
              strokes={displayStrokes}
              onStrokesChange={() => {}}
              color={color}
              brushSize={brushSize}
              tool={tool}
              disabled={!isMyTurn}
              onStrokeStart={handleStrokeStart}
              onStrokePoint={handleStrokePoint}
              onStrokeEnd={handleStrokeEnd}
            />
            {!isMyTurn && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-ink/70 text-white text-xs px-3 py-1 rounded-full whitespace-nowrap">
                {opponent?.nickname ?? "对方"}正在画...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 工具栏（仅自己回合可用） */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c.name}
                disabled={toolbarDisabled}
                onClick={() => {
                  setColor(c.value);
                  setTool("pen");
                  playSfx(sfx.uiTick);
                }}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  color === c.value && tool === "pen"
                    ? "border-ink scale-125 ring-2 ring-sun"
                    : "border-ink/30"
                } ${toolbarDisabled ? "opacity-40" : ""}`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
          <button
            disabled={toolbarDisabled}
            onClick={() => {
              setTool(tool === "pen" ? "eraser" : "pen");
              playSfx(sfx.uiTick);
            }}
            className={`btn-press p-2 rounded-doodle border-2 ${
              tool === "eraser"
                ? "bg-warn text-white border-ink"
                : "bg-white text-ink border-ink"
            } ${toolbarDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {tool === "eraser" ? <Eraser size={18} /> : <Pencil size={18} />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted font-body">粗细</span>
          {BRUSH_SIZES.map((b) => (
            <button
              key={b.value}
              disabled={toolbarDisabled}
              onClick={() => {
                setBrushSize(b.value);
                playSfx(sfx.uiTick);
              }}
              className={`flex-1 py-1.5 rounded-doodle border-2 font-display text-sm transition-all ${
                brushSize === b.value
                  ? "bg-ink text-cream border-ink"
                  : "bg-white text-ink border-ink/30"
              } ${toolbarDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ 评分阶段（ROUND_RESULT） ============
function CoOpRating({ roomId }: { roomId: string }) {
  const { coOpStrokes, coOpResult, coOpMyRated, myId, room } = useGameStore();
  const { coOpRate } = useRoomActions();
  const { sfxEnabled } = useAudioStore();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };
  const [selectedRating, setSelectedRating] = useState<number>(0);

  // 渲染最终画作为图片
  const finalImage = useMemo(() => strokesToDataURL(coOpStrokes), [coOpStrokes]);

  const handleSubmit = () => {
    if (selectedRating < 1 || selectedRating > 5 || coOpMyRated) return;
    playSfx(sfx.click);
    coOpRate(roomId, selectedRating);
    useGameStore.getState().setCoOpMyRated(true);
  };

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-4 animate-bounce-in">
          <div className="text-4xl mb-1">🎨</div>
          <h1 className="font-display text-2xl text-ink">画作完成！</h1>
          <p className="text-ink-muted text-sm mt-1">
            给这幅合作画作打个分吧
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

        {/* 已有评分展示（对方先评的话会显示） */}
        {coOpResult && Object.keys(coOpResult.ratings).length > 0 && (
          <div className="flex items-center justify-center gap-3 mb-3 text-sm text-ink-muted">
            {Object.entries(coOpResult.ratings).map(([pid, rating]) => {
              const p = room?.players.find((pl) => pl.id === pid);
              return (
                <span key={pid}>
                  {pid === myId ? "你" : p?.nickname ?? "对方"}：{rating}★
                </span>
              );
            })}
          </div>
        )}

        {/* 评分按钮 */}
        {!coOpMyRated ? (
          <>
            <div className="flex items-center justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setSelectedRating(n);
                    playSfx(sfx.uiTick);
                  }}
                  className={`btn-press p-1 transition-all ${
                    selectedRating >= n ? "scale-110" : "opacity-40"
                  }`}
                >
                  <span
                    className={`text-4xl ${
                      selectedRating >= n ? "text-sun" : "text-ink-muted/30"
                    }`}
                  >
                    ★
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={handleSubmit}
              disabled={selectedRating === 0}
              className="btn-press w-full py-3 bg-coral text-white font-display text-lg rounded-doodle border-2 border-ink shadow-soft disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Check size={20} />
              提交评分
            </button>
          </>
        ) : (
          <div className="text-center py-4">
            <Loader2 size={28} className="animate-spin text-coral mx-auto mb-2" />
            <p className="text-ink-muted text-sm">已评分，等待对方...</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 结果页（GAME_OVER） ============
function CoOpResult({ roomId }: { roomId: string }) {
  const { coOpStrokes, coOpResult, coOpPrompt, myId, room } = useGameStore();
  const { coOpRestart, leaveRoom } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };
  const isHost = room?.hostId === myId;

  // 渲染最终画作为图片
  const finalImage = useMemo(() => strokesToDataURL(coOpStrokes), [coOpStrokes]);

  const handleDownload = () => {
    playSfx(sfx.click);
    const dataURL = strokesToDataURL(coOpStrokes);
    if (!dataURL) return;
    const a = document.createElement("a");
    a.href = dataURL;
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

  const avgRating = coOpResult?.avgRating ?? 0;
  const ratings = coOpResult?.ratings ?? {};

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-4 animate-bounce-in">
          <div className="text-5xl mb-2 animate-float">🏆</div>
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

        {/* 评分展示 */}
        <div className="bg-white rounded-blob border-2 border-ink shadow-soft p-4 mb-4 text-center">
          <p className="text-xs text-ink-muted mb-1">平均评分</p>
          <div className="flex items-center justify-center mb-1">
            <Stars rating={Math.round(avgRating)} />
          </div>
          <p className="font-display text-2xl text-ink">{avgRating} / 5</p>
          {/* 双方评分明细 */}
          <div className="flex items-center justify-center gap-3 mt-3 text-xs text-ink-muted">
            {room?.players.map((p) => (
              <span key={p.id}>
                {p.id === myId ? "你" : p.nickname}：{ratings[p.id] ?? "-"}★
              </span>
            ))}
          </div>
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
