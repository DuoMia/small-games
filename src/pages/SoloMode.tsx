import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Undo2,
  Trash2,
  Eraser,
  Pencil,
  Check,
  AlertTriangle,
  Send,
  ArrowRight,
  Home,
  RotateCcw,
  X,
  User,
  Heart,
  Bell,
  Smile,
  Sparkles,
  Download,
  Trophy,
  Eye,
  Loader2,
} from "lucide-react";
import {
  DrawingCanvas,
  type DrawingCanvasHandle,
  type Stroke,
} from "@/components/DrawingCanvas";
import { hasTextSuspicion } from "@/utils/textDetect";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import {
  DIFFICULTY_LIST,
  DEFAULT_DIFFICULTY,
  getDifficultyConfig,
  VIEW_TIME,
  DRAW_TIME,
  type Difficulty,
} from "@/lib/difficulty";
import wordBank from "../../api/data/words.json";
import telepathyPacks from "../../api/data/telepathy-questions.json";
import drawingPrompts from "../../api/data/drawing-prompts.json";
import emojiPuzzles from "../../api/data/emoji-puzzles.json";
import type { GameType, HeartCard, HeartFruit, DaVinciCard, DaVinciColor } from "@/lib/types";
import { HeartCardView, CardBack } from "@/game/HeartAttackGame";
import Confetti from "@/components/Confetti";

// ============ 单人模式分发器 ============
// 根据路由 /solo/:gameType 渲染不同的单人游戏组件
const SOLO_GAME_NAMES: Record<GameType, string> = {
  "draw-memory": "画词记忆",
  "telepathy": "默契考验",
  "heart-attack": "德国心脏病",
  "co-op-drawing": "合作画画",
  "emoji-guessing": "表情包猜词",
  "davinci-code": "达芬奇密码",
};

const SOLO_GAME_EMOJI: Record<GameType, string> = {
  "draw-memory": "🎨",
  "telepathy": "💕",
  "heart-attack": "🔔",
  "co-op-drawing": "✏️",
  "emoji-guessing": "😎",
  "davinci-code": "🔐",
};

export default function SoloMode() {
  const { gameType } = useParams<{ gameType: string }>();
  const navigate = useNavigate();

  // 没有 gameType 或不合法，回首页
  if (!gameType || !SOLO_GAME_NAMES[gameType as GameType]) {
    return (
      <div className="paper-bg h-[100dvh] flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <div className="text-5xl mb-3">🤔</div>
          <p className="font-display text-ink text-lg mb-4">未选择有效的游戏</p>
          <button
            onClick={() => navigate("/")}
            className="btn-press px-6 py-3 bg-coral text-white rounded-doodle border-2 border-ink font-display"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const gt = gameType as GameType;
  switch (gt) {
    case "draw-memory":
      return <SoloDrawMemory />;
    case "telepathy":
      return <SoloTelepathy />;
    case "heart-attack":
      return <SoloHeartAttack />;
    case "co-op-drawing":
      return <SoloCoOpDrawing />;
    case "emoji-guessing":
      return <SoloEmoji />;
    case "davinci-code":
      return <SoloDaVinci />;
    default:
      return null;
  }
}

interface WordEntry {
  word: string;
  synonyms: string[];
  category: string;
}

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

interface Question {
  questionIndex: number;
  wordIndex: number;
  correctAnswer: string;
  acceptedAnswers: string[];
}

/** 把笔画渲染成 DataURL（单张，同步） */
function strokesToDataURL(strokes: Stroke[]): string {
  const canvas = document.createElement("canvas");
  // 降低分辨率以减少 toDataURL 开销
  const W = 400;
  const H = 300;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);
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
    // 坐标缩放
    ctx.moveTo((first.x / CANVAS_W) * W, (first.y / CANVAS_H) * H);
    if (stroke.points.length === 1) {
      ctx.arc(
        (first.x / CANVAS_W) * W,
        (first.y / CANVAS_H) * H,
        stroke.size / 2,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = stroke.color;
      ctx.fill();
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(
          (stroke.points[i].x / CANVAS_W) * W,
          (stroke.points[i].y / CANVAS_H) * H
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
    if (i % 3 === 2) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return results;
}

function pickWords(count: number, categories: string[]): WordEntry[] {
  let pool = [...wordBank];
  if (categories.length > 0) {
    const filtered = pool.filter((w) => categories.includes(w.category));
    if (filtered.length >= count) pool = filtered;
  }
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function genQuestions(words: WordEntry[], count: number): Question[] {
  const indices = Array.from({ length: words.length }, (_, i) => i)
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(count, words.length));
  return indices.map((idx, i) => ({
    questionIndex: i,
    wordIndex: idx,
    correctAnswer: words[idx].word,
    acceptedAnswers: [words[idx].word, ...words[idx].synonyms],
  }));
}

function checkAnswer(answer: string, accepted: string[]): boolean {
  const n = answer.trim().toLowerCase();
  if (!n) return false;
  return accepted.some((a) => a.trim().toLowerCase() === n);
}

type SoloStage = "intro" | "draw" | "quiz" | "result";
type DrawMode = "view" | "draw" | "done";

function SoloDrawMemory() {
  const navigate = useNavigate();
  const { sfxEnabled } = useAudioStore();

  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  // 整体阶段
  const [stage, setStage] = useState<SoloStage>("intro");

  // 难度选择（只影响词库筛选，不影响时间和题量）
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const diffConfig = getDifficultyConfig(difficulty);

  // 题量选择（独立于难度，词数=题数）
  const [quizCount, setQuizCount] = useState<number>(15);

  // 画图阶段状态
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const [wordEntries, setWordEntries] = useState<WordEntry[]>([]);
  const [drawings, setDrawings] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drawMode, setDrawMode] = useState<DrawMode>("view");
  const [timeLeft, setTimeLeft] = useState(VIEW_TIME);
  const [pages, setPages] = useState<Stroke[][]>([]);
  const [color, setColor] = useState(COLORS[0].value);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1].value);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [showWarning, setShowWarning] = useState(true);
  const [textAlert, setTextAlert] = useState<string | null>(null);
  const pagesRef = useRef<Stroke[][]>([]);

  // 答题阶段状态
  const [questions, setQuestions] = useState<Question[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [quizResult, setQuizResult] = useState<{
    correct: boolean;
    correctAnswer: string;
  } | null>(null);
  const [score, setScore] = useState(0);

  // 词数 = 题数，由用户独立选择
  const totalPages = quizCount;
  const viewTime = VIEW_TIME;
  const drawTime = DRAW_TIME;

  // 开始单人游戏
  const startSolo = () => {
    const picked = pickWords(totalPages, diffConfig.categories);
    setWordEntries(picked);
    setPages(Array.from({ length: totalPages }, () => []));
    setDrawings([]);
    setCurrentIndex(0);
    setDrawMode("view");
    setTimeLeft(viewTime);
    setShowWarning(true);
    setScore(0);
    setStage("draw");
    playSfx(sfx.click);
  };

  // 检测当前画布是否疑似含文字
  const checkTextAlert = useCallback(
    (strokes: Stroke[], idx: number) => {
      if (strokes.length > 0 && hasTextSuspicion(strokes)) {
        setTextAlert(`第 ${idx + 1} 张画疑似写了文字，请用图画表达！`);
        setTimeout(() => setTextAlert(null), 3000);
      }
    },
    []
  );

  // 上一次的倒计时秒数（用于触发滴答音效）
  const lastSecRef = useRef<number>(-1);

  // 画图阶段倒计时驱动 view → draw → next
  useEffect(() => {
    if (stage !== "draw") return;
    if (drawMode === "done") return;
    const start = Date.now();
    const duration = drawMode === "view" ? viewTime : drawTime;
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
        // 最后 3 秒急促
        if (left <= 3 && left > 0) {
          playSfx(sfx.tickUrgent);
        } else {
          playSfx(sfx.tick);
        }
      }
      if (left <= 0) {
        clearInterval(interval);
        if (drawMode === "view") {
          setDrawMode("draw");
        } else {
          // draw 结束，保存当前画布并进入下一个词
          const currentStrokes = canvasRef.current?.getStrokes() ?? [];
          setPages((prev) => {
            const next = [...prev];
            next[currentIndex] = currentStrokes;
            pagesRef.current = next;
            return next;
          });
          checkTextAlert(currentStrokes, currentIndex);
          if (currentIndex + 1 >= totalPages) {
            setDrawMode("done");
          } else {
            setCurrentIndex((i) => i + 1);
            setDrawMode("view");
          }
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [stage, drawMode, currentIndex, checkTextAlert, viewTime, drawTime, totalPages, playSfx]);

  // 画图全部完成 → 异步分批生成 DataURL + 题目，进入答题
  useEffect(() => {
    if (stage !== "draw" || drawMode !== "done") return;
    let cancelled = false;
    (async () => {
      const finalPages = pagesRef.current;
      const dataURLs = await strokesBatchToDataURLs(finalPages);
      if (cancelled) return;
      setDrawings(dataURLs);
      setQuestions(genQuestions(wordEntries, quizCount));
      setQuizIndex(0);
      setAnswer("");
      setQuizResult(null);
      setStage("quiz");
      playSfx(sfx.roundEnd);
    })();
    return () => { cancelled = true; };
  }, [stage, drawMode, wordEntries, quizCount, playSfx]);

  const handleStrokesChange = useCallback(
    (strokes: Stroke[]) => {
      setPages((prev) => {
        const next = [...prev];
        next[currentIndex] = strokes;
        pagesRef.current = next;
        return next;
      });
    },
    [currentIndex]
  );

  // 手动跳过当前词的剩余画图时间
  const handleSkip = useCallback(() => {
    if (drawMode !== "draw") return;
    const currentStrokes = canvasRef.current?.getStrokes() ?? [];
    setPages((prev) => {
      const next = [...prev];
      next[currentIndex] = currentStrokes;
      pagesRef.current = next;
      return next;
    });
    checkTextAlert(currentStrokes, currentIndex);
    if (currentIndex + 1 >= totalPages) {
      setDrawMode("done");
    } else {
      setCurrentIndex((i) => i + 1);
      setDrawMode("view");
    }
    playSfx(sfx.click);
  }, [drawMode, currentIndex, checkTextAlert, totalPages, playSfx]);

  // 答题：提交答案
  const handleSubmitAnswer = () => {
    if (!answer.trim() || quizResult) return;
    const q = questions[quizIndex];
    if (!q) return;
    const correct = checkAnswer(answer.trim(), q.acceptedAnswers);
    setQuizResult({ correct, correctAnswer: q.correctAnswer });
    if (correct) setScore((s) => s + 1);
    playSfx(correct ? sfx.correct : sfx.wrong);
  };

  // 答题：下一题
  const handleNextQuestion = () => {
    if (quizIndex + 1 >= quizCount) {
      setStage("result");
      playSfx(sfx.win);
      return;
    }
    setQuizIndex((i) => i + 1);
    setAnswer("");
    setQuizResult(null);
    playSfx(sfx.click);
  };

  // 切题时重置输入
  useEffect(() => {
    if (stage === "quiz") {
      setAnswer("");
      setQuizResult(null);
    }
  }, [quizIndex, stage]);

  const words = wordEntries.map((w) => w.word);
  const drawnCount = pages.filter((p) => p.length > 0).length;
  const isView = drawMode === "view";
  const isDraw = drawMode === "draw";
  const currentQ = questions[quizIndex];
  const currentDrawing = drawings[currentQ?.wordIndex ?? 0] || "";

  /* ============ 介绍页 ============ */
  if (stage === "intro") {
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative">
        <div className="absolute top-10 left-5 text-6xl animate-float opacity-20">🎨</div>
        <div className="absolute top-20 right-5 text-5xl animate-float opacity-20" style={{ animationDelay: "1s" }}>✏️</div>
        <div className="absolute bottom-20 left-8 text-5xl animate-float opacity-20" style={{ animationDelay: "2s" }}>🧠</div>

        <div className="w-full max-w-md flex flex-col items-center relative z-10">
          <div className="mt-8 mb-2 text-center animate-bounce-in">
            <h1 className="font-display text-5xl text-ink leading-tight">画词记忆 · 单人游玩</h1>
            <div className="mt-1 flex items-center justify-center gap-2">
              <div className="h-1 w-16 bg-mint rounded-full" />
              <User size={20} className="text-mint" />
              <div className="h-1 w-16 bg-mint rounded-full" />
            </div>
            <p className="font-body text-ink-muted text-sm mt-3">
              单人游玩：画词记忆 · 不需要联网 · 独立测试游玩
            </p>
          </div>

          <div className="w-full bg-white rounded-blob shadow-card border-3 border-ink p-6 mt-6 animate-slide-up">
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-3 bg-coral-light rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-coral border-2 border-ink font-display text-white">1</div>
                <div className="flex-1">
                  <div className="font-display text-ink">看词 {viewTime} 秒</div>
                  <div className="text-xs text-ink-muted">词语依次展示，记住它们</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-sun rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-ink border-2 border-ink font-display text-cream">2</div>
                <div className="flex-1">
                  <div className="font-display text-ink">画图 {drawTime} 秒</div>
                  <div className="text-xs text-ink-muted">凭记忆作画，不能写文字！</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-mint rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-mint border-2 border-ink font-display text-ink">3</div>
                <div className="flex-1">
                  <div className="font-display text-ink">看画猜词</div>
                  <div className="text-xs text-ink-muted">{quizCount} 道题，看自己的画反推词语</div>
                </div>
              </div>
            </div>

            {/* 难度选择 */}
            <div className="mb-4">
              <p className="font-display text-ink text-sm mb-2">难度选择</p>
              <div className="grid grid-cols-2 gap-2">
                {DIFFICULTY_LIST.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => {
                      setDifficulty(d.key);
                      playSfx(sfx.uiTick);
                    }}
                    className={`py-2.5 rounded-doodle border-2 font-display text-sm transition-all flex items-center justify-center gap-1.5 ${
                      difficulty === d.key
                        ? "bg-coral text-white border-ink shadow-soft"
                        : "bg-white text-ink border-ink/30"
                    }`}
                  >
                    <span>{d.icon}</span>
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="text-center text-xs text-ink-muted mt-2">
                词语：{diffConfig.categoryDesc}
              </p>
            </div>

            {/* 题量选择 */}
            <div className="mb-5">
              <p className="font-display text-ink text-sm mb-2">题量选择</p>
              <div className="flex gap-2">
                {[15, 30].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setQuizCount(n);
                      playSfx(sfx.uiTick);
                    }}
                    className={`flex-1 py-3 rounded-doodle border-2 font-display text-base transition-all ${
                      quizCount === n
                        ? "bg-coral text-white border-ink shadow-soft"
                        : "bg-white text-ink border-ink/30"
                    }`}
                  >
                    {n} 题
                  </button>
                ))}
              </div>
              <p className="text-center text-xs text-ink-muted mt-2">
                画 {quizCount} 个词 · 答 {quizCount} 题 · 每题 1 分
              </p>
            </div>

            <button
              onClick={startSolo}
              className="btn-press w-full py-4 bg-mint text-ink font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2"
            >
              <Pencil size={22} />
              开始测试
            </button>
            <button
              onClick={() => {
                playSfx(sfx.click);
                navigate("/");
              }}
              className="btn-press w-full py-2 mt-3 text-ink-muted font-body text-sm"
            >
              ← 返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ============ 画图阶段 ============ */
  if (stage === "draw") {
    return (
      <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="font-display text-ink text-sm">画词记忆 · 单人游玩</span>
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
            <div className="flex-1 flex flex-col items-center justify-center">
              <p className="font-body text-ink-muted text-sm mb-4">
                记住这个词，等下凭记忆画出来
              </p>
              <div className="bg-white rounded-blob border-3 border-ink shadow-card px-8 py-6 animate-bounce-in">
                <span className="font-display text-4xl sm:text-5xl text-ink break-all">
                  {words[currentIndex] || ""}
                </span>
              </div>
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

          {drawMode === "done" && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-5xl mb-3 animate-float">📝</div>
                <p className="font-display text-2xl text-ink">正在准备题目...</p>
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
                    playSfx(sfx.uiTick);
                  }}
                  className="btn-press p-2 rounded-doodle border-2 border-ink bg-white text-ink"
                >
                  <Undo2 size={18} />
                </button>
                <button
                  onClick={() => {
                    canvasRef.current?.clear();
                    playSfx(sfx.uiTick);
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

  /* ============ 答题阶段 ============ */
  if (stage === "quiz") {
    if (!currentQ) {
      return (
        <div className="paper-bg h-[100dvh] flex items-center justify-center">
          <p className="text-ink-muted">准备题目中...</p>
        </div>
      );
    }
    return (
      <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
          <span className="font-display text-ink text-sm">画词记忆 · 单人游玩 · 答题</span>
          <div className="flex items-center gap-2">
            <span className="font-display text-ink text-sm bg-sun px-3 py-1 rounded-full border-2 border-ink">
              第 {quizIndex + 1} / {quizCount} 题
            </span>
            <span className="font-display text-mint text-sm bg-mint/10 px-3 py-1 rounded-full border-2 border-mint">
              {score} 分
            </span>
          </div>
        </div>

        {/* 题目 */}
        <div className="flex-shrink-0 px-4 pt-2 pb-1 text-center">
          <p className="font-body text-ink-muted text-sm">看画回忆，这个词语是什么？</p>
          <h2 className="font-display text-2xl text-ink mt-1">
            第 <span className="text-coral">{currentQ.wordIndex + 1}</span> 个词
          </h2>
        </div>

        {/* 画作参考 */}
        <div className="flex-1 flex items-center justify-center px-4 py-3 min-h-0">
          <div className="relative w-full max-w-xs aspect-[4/3] bg-white rounded-doodle border-3 border-ink shadow-card overflow-hidden">
            {currentDrawing ? (
              <img
                src={currentDrawing}
                alt={`第${currentQ.wordIndex + 1}张画`}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ink-muted text-sm">
                <div className="text-center">
                  <div className="text-3xl mb-1">🎨</div>
                  <div>这张没画</div>
                </div>
              </div>
            )}
            <div className="absolute top-2 left-2 bg-sun text-ink font-display text-xs px-2 py-0.5 rounded-full border border-ink">
              #{currentQ.wordIndex + 1}
            </div>
            {quizResult && (
              <div
                className={`absolute inset-0 flex items-center justify-center ${
                  quizResult.correct ? "bg-mint/40" : "bg-coral/40"
                }`}
              >
                <div
                  className={`transform scale-150 ${
                    quizResult.correct
                      ? "text-mint animate-bounce-in"
                      : "text-coral animate-shake"
                  }`}
                >
                  {quizResult.correct ? <Check size={48} /> : <X size={48} />}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 答案展示 */}
        {quizResult && (
          <div className="flex-shrink-0 px-4 pb-1 text-center animate-slide-up">
            <p className="text-sm">
              {quizResult.correct ? (
                <span className="text-mint font-display">答对了！+1分 🎉</span>
              ) : (
                <span className="text-coral font-display">
                  答错了！正确答案：
                  <span className="text-ink">{quizResult.correctAnswer}</span>
                </span>
              )}
            </p>
          </div>
        )}

        {/* 输入区 */}
        <div className="flex-shrink-0 bg-white border-t-2 border-ink px-4 py-3">
          {!quizResult ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmitAnswer()}
                placeholder="输入你猜的词语..."
                maxLength={20}
                autoFocus
                className="flex-1 min-w-0 px-4 py-3 rounded-doodle border-2 border-ink bg-cream font-body text-ink focus:bg-white focus:border-coral transition-colors"
              />
              <button
                onClick={handleSubmitAnswer}
                disabled={!answer.trim()}
                className="btn-press flex-shrink-0 flex items-center gap-1 px-5 py-3 bg-coral text-white font-display rounded-doodle border-2 border-ink shadow-soft disabled:opacity-40 whitespace-nowrap"
              >
                <Send size={18} />
                确定
              </button>
            </div>
          ) : (
            <button
              onClick={handleNextQuestion}
              className="btn-press w-full py-3 bg-ink text-cream font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
            >
              {quizIndex + 1 >= quizCount ? "查看结果" : "下一题"}
              <ArrowRight size={20} />
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ============ 结果页 ============ */
  if (stage === "result") {
    const passed = score >= quizCount * 0.6;
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-md bg-white rounded-blob shadow-card border-3 border-ink p-8 text-center animate-bounce-in">
          <div className="text-6xl mb-3 animate-float">
            {score >= quizCount * 0.8 ? "🏆" : passed ? "🎉" : "💪"}
          </div>
          <h2 className="font-display text-3xl text-ink mb-1">测试完成！</h2>
          <p className="font-body text-ink-muted text-sm mb-2">
            难度：{diffConfig.icon} {diffConfig.label}
          </p>
          <p className="font-body text-ink-muted text-sm mb-6">
            {score >= quizCount * 0.8
              ? "记忆力超强！"
              : passed
              ? "不错的表现！"
              : "再练练会更好！"}
          </p>

          <div className="bg-cream rounded-doodle border-2 border-ink p-5 mb-6">
            <div className="font-display text-5xl text-coral mb-1">
              {score}
              <span className="text-2xl text-ink-muted"> / {quizCount}</span>
            </div>
            <p className="font-body text-sm text-ink-muted">答对题数</p>
          </div>

          <button
            onClick={startSolo}
            className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2 mb-3"
          >
            <RotateCcw size={22} />
            再来一局
          </button>
          <button
            onClick={() => {
              playSfx(sfx.click);
              navigate("/");
            }}
            className="btn-press w-full py-3 bg-white text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
          >
            <Home size={20} />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ============ 单人默契考验 ============
interface TelepathyPack {
  id: string;
  name: string;
  icon: string;
  color: string;
  questions: { question: string; options: string[] }[];
}
interface TelepathyQ {
  questionIndex: number;
  question: string;
  options: string[];
}
const SOLO_TELEPATHY_TOTAL = 10;
const SOLO_TELEPATHY_CHOICE_TIME = 15;
const OPTION_LETTERS = ["A", "B", "C", "D", "E"];

function pickTelepathyQuestions(count: number): TelepathyQ[] {
  const allQs = (telepathyPacks as TelepathyPack[]).flatMap((p) => p.questions);
  const shuffled = [...allQs].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length)).map((q, i) => ({
    questionIndex: i,
    question: q.question,
    options: q.options,
  }));
}

function SoloTelepathy() {
  const navigate = useNavigate();
  const { sfxEnabled } = useAudioStore();

  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  const [stage, setStage] = useState<"intro" | "playing" | "result">("intro");
  const [questions, setQuestions] = useState<TelepathyQ[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [myChoice, setMyChoice] = useState<number | null>(null);
  const [friendChoice, setFriendChoice] = useState<number | null>(null);
  const [matchType, setMatchType] = useState<"full" | "partial" | "none" | null>(null);
  const [timeLeft, setTimeLeft] = useState(SOLO_TELEPATHY_CHOICE_TIME);
  const [score, setScore] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const submittedRef = useRef(false);
  const lastSecRef = useRef<number>(-1);

  const currentQ = questions[qIndex];

  const startTelepathy = () => {
    setQuestions(pickTelepathyQuestions(SOLO_TELEPATHY_TOTAL));
    setQIndex(0);
    setMyChoice(null);
    setFriendChoice(null);
    setMatchType(null);
    setScore(0);
    setMatchedCount(0);
    setStage("playing");
    playSfx(sfx.click);
  };

  // 切题重置
  useEffect(() => {
    if (stage !== "playing") return;
    setMyChoice(null);
    setFriendChoice(null);
    setMatchType(null);
    submittedRef.current = false;
    setTimeLeft(SOLO_TELEPATHY_CHOICE_TIME);
    lastSecRef.current = Math.ceil(SOLO_TELEPATHY_CHOICE_TIME);
  }, [qIndex, stage]);

  // 倒计时
  useEffect(() => {
    if (stage !== "playing" || !currentQ) return;
    if (myChoice !== null) return; // 已选完，停止倒计时

    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, SOLO_TELEPATHY_CHOICE_TIME - elapsed);
      setTimeLeft(left);
      const sec = Math.ceil(left);
      if (sec !== lastSecRef.current && sec > 0) {
        lastSecRef.current = sec;
        if (left <= 3 && left > 0) {
          playSfx(sfx.tickUrgent);
        } else {
          playSfx(sfx.tick);
        }
      }
      // 超时自动选最后一项
      if (left <= 0 && !submittedRef.current) {
        submittedRef.current = true;
        const defaultChoice = (currentQ.options.length || 5) - 1;
        commitChoice(defaultChoice);
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, qIndex, myChoice, currentQ, playSfx]);

  const commitChoice = (idx: number) => {
    if (!currentQ) return;
    setMyChoice(idx);
    // 模拟朋友答案：完全随机
    const friend = Math.floor(Math.random() * currentQ.options.length);
    setFriendChoice(friend);
    // 计算匹配度
    const diff = Math.abs(idx - friend);
    let mt: "full" | "partial" | "none";
    let gain: number;
    if (diff === 0) {
      mt = "full";
      gain = 10;
      setMatchedCount((c) => c + 1);
    } else if (diff === 1) {
      mt = "partial";
      gain = 5;
    } else {
      mt = "none";
      gain = 0;
    }
    setMatchType(mt);
    setScore((s) => s + gain);
    playSfx(mt === "full" ? sfx.correct : mt === "partial" ? sfx.uiTick : sfx.wrong);
  };

  const handleSelect = (idx: number) => {
    if (myChoice !== null) return;
    submittedRef.current = true;
    playSfx(sfx.click);
    commitChoice(idx);
  };

  const handleNext = () => {
    if (qIndex + 1 >= SOLO_TELEPATHY_TOTAL) {
      setStage("result");
      playSfx(sfx.win);
      return;
    }
    setQIndex((i) => i + 1);
    playSfx(sfx.click);
  };

  /* ============ 介绍页 ============ */
  if (stage === "intro") {
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative">
        <div className="absolute top-10 left-5 text-6xl animate-float opacity-20">💕</div>
        <div className="absolute top-20 right-5 text-5xl animate-float opacity-20" style={{ animationDelay: "1s" }}>🤝</div>
        <div className="absolute bottom-20 left-8 text-5xl animate-float opacity-20" style={{ animationDelay: "2s" }}>💖</div>

        <div className="w-full max-w-md flex flex-col items-center relative z-10">
          <div className="mt-8 mb-2 text-center animate-bounce-in">
            <h1 className="font-display text-5xl text-ink leading-tight">默契考验 · 单人游玩</h1>
            <div className="mt-1 flex items-center justify-center gap-2">
              <div className="h-1 w-16 bg-coral rounded-full" />
              <Heart size={20} className="text-coral" />
              <div className="h-1 w-16 bg-coral rounded-full" />
            </div>
            <p className="font-body text-ink-muted text-sm mt-3">
              单人游玩：默契考验 · 不需要联网 · 模拟朋友答案
            </p>
          </div>

          <div className="w-full bg-white rounded-blob shadow-card border-3 border-ink p-6 mt-6 animate-slide-up">
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-3 bg-coral-light rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-coral border-2 border-ink font-display text-white">1</div>
                <div className="flex-1">
                  <div className="font-display text-ink">看题作答</div>
                  <div className="text-xs text-ink-muted">每题 5 个选项，限时 15 秒</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-sun rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-ink border-2 border-ink font-display text-cream">2</div>
                <div className="flex-1">
                  <div className="font-display text-ink">模拟朋友</div>
                  <div className="text-xs text-ink-muted">系统随机模拟朋友的选择</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-mint rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-mint border-2 border-ink font-display text-ink">3</div>
                <div className="flex-1">
                  <div className="font-display text-ink">看默契度</div>
                  <div className="text-xs text-ink-muted">完全一致 +10 · 相邻 +5 · 共 10 题</div>
                </div>
              </div>
            </div>

            <button
              onClick={startTelepathy}
              className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2"
            >
              <Heart size={22} />
              开始测试
            </button>
            <button
              onClick={() => {
                playSfx(sfx.click);
                navigate("/");
              }}
              className="btn-press w-full py-2 mt-3 text-ink-muted font-body text-sm"
            >
              ← 返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ============ 结果页 ============ */
  if (stage === "result") {
    const percent = Math.round((score / (SOLO_TELEPATHY_TOTAL * 10)) * 100);
    let grade = "";
    let gradeEmoji = "";
    if (percent >= 80) {
      grade = "心有灵犀";
      gradeEmoji = "💕";
    } else if (percent >= 60) {
      grade = "默契不错";
      gradeEmoji = "😊";
    } else if (percent >= 40) {
      grade = "还需磨合";
      gradeEmoji = "🤔";
    } else {
      grade = "毫无默契";
      gradeEmoji = "💔";
    }
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-md bg-white rounded-blob shadow-card border-3 border-ink p-8 text-center animate-bounce-in">
          <div className="text-6xl mb-3 animate-float">{gradeEmoji}</div>
          <h2 className="font-display text-3xl text-coral mb-1">{grade}</h2>
          <p className="font-body text-ink-muted text-sm mb-6">默契考验完成</p>

          <div className="bg-cream rounded-doodle border-2 border-ink p-5 mb-3">
            <p className="font-body text-ink-muted text-sm mb-1">默契度</p>
            <div className="font-display text-6xl text-ink leading-none">
              {percent}
              <span className="text-3xl text-ink-muted">%</span>
            </div>
            <div className="mt-3 h-3 bg-cream-dark rounded-full overflow-hidden border border-ink/20">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  percent >= 80 ? "bg-mint" : percent >= 60 ? "bg-sun" : percent >= 40 ? "bg-coral" : "bg-ink-muted"
                }`}
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
          </div>

          <div className="bg-cream rounded-doodle border-2 border-ink p-3 mb-6 text-sm">
            <span className="text-ink-muted">完全一致：</span>
            <span className="font-display text-coral">{matchedCount}</span>
            <span className="text-ink-muted"> / {SOLO_TELEPATHY_TOTAL} 题</span>
            <span className="mx-2 text-ink-muted">·</span>
            <span className="text-ink-muted">得分：</span>
            <span className="font-display text-coral">{score}</span>
          </div>

          <button
            onClick={startTelepathy}
            className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2 mb-3"
          >
            <RotateCcw size={22} />
            再来一局
          </button>
          <button
            onClick={() => {
              playSfx(sfx.click);
              navigate("/");
            }}
            className="btn-press w-full py-3 bg-white text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
          >
            <Home size={20} />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  /* ============ 答题中 ============ */
  if (!currentQ) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <p className="text-ink-muted">准备题目中...</p>
      </div>
    );
  }

  const isChosen = myChoice !== null;
  const seconds = Math.ceil(timeLeft);
  const isUrgent = seconds <= 3 && seconds > 0 && !isChosen;
  const isLast = qIndex + 1 >= SOLO_TELEPATHY_TOTAL;

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Heart size={16} className="text-coral" />
          <span className="font-display text-ink text-sm">默契考验 · 单人</span>
        </div>
        <div className="font-display text-ink text-sm bg-coral-light px-3 py-1 rounded-full border-2 border-ink">
          第 {qIndex + 1} / {SOLO_TELEPATHY_TOTAL} 题
        </div>
      </div>

      {/* 倒计时 */}
      <div className="flex-shrink-0 px-4 py-2">
        <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
          <span>{isChosen ? "已选择" : "作答中"}</span>
          <span className={isUrgent ? "text-coral font-display" : ""}>
            {isChosen ? "✓" : `${seconds}s`}
          </span>
        </div>
        <div className="h-2 bg-cream-dark rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-100 ${isUrgent ? "bg-coral" : "bg-mint"}`}
            style={{ width: `${(timeLeft / SOLO_TELEPATHY_CHOICE_TIME) * 100}%` }}
          />
        </div>
      </div>

      {/* 题目 */}
      <div className="flex-shrink-0 px-4 pt-2 pb-2 text-center">
        <div className="bg-white rounded-blob border-3 border-ink shadow-card px-5 py-3 inline-block">
          <p className="font-display text-xl text-ink leading-tight">{currentQ.question}</p>
        </div>
      </div>

      {/* 选项 */}
      <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
        <div className="grid grid-cols-1 gap-2 max-w-md mx-auto">
          {currentQ.options.map((opt, idx) => {
            const isMy = myChoice === idx;
            const isFriend = friendChoice === idx;
            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                disabled={isChosen}
                className={`flex items-center gap-3 px-4 py-3 rounded-doodle border-2 font-body transition-all text-left ${
                  isChosen
                    ? isMy
                      ? "bg-coral text-white border-ink shadow-soft"
                      : isFriend
                      ? "bg-mint text-ink border-ink"
                      : "bg-cream text-ink-muted border-ink/20 opacity-60"
                    : "bg-white text-ink border-ink/30 btn-press hover:border-coral"
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full border-2 border-ink font-display text-sm flex-shrink-0 ${
                    isChosen && isMy ? "bg-white text-coral" : "bg-sun text-ink"
                  }`}
                >
                  {OPTION_LETTERS[idx]}
                </div>
                <span className="flex-1">{opt}</span>
                {isMy && <Check size={18} className="text-white" />}
                {isChosen && isFriend && !isMy && (
                  <span className="text-xs font-display text-mint flex items-center gap-0.5">
                    <Heart size={12} /> 朋友
                  </span>
                )}
                {isChosen && isFriend && isMy && (
                  <span className="text-xs font-display text-white/90 flex items-center gap-0.5">
                    <Heart size={12} /> 朋友
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-4 py-3">
        {isChosen && matchType ? (
          <div className="space-y-2">
            <div
              className={`text-center py-2 rounded-doodle border-2 ${
                matchType === "full"
                  ? "border-mint bg-mint/10 text-mint"
                  : matchType === "partial"
                  ? "border-sun bg-sun/10 text-sun"
                  : "border-coral bg-coral/10 text-coral"
              }`}
            >
              <span className="font-display">
                {matchType === "full" ? "💕 心有灵犀！+10" : matchType === "partial" ? "🤏 差一点！+5" : "💔 没默契 +0"}
              </span>
            </div>
            <button
              onClick={handleNext}
              className="btn-press w-full py-3 bg-ink text-cream font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
            >
              {isLast ? "查看默契度" : "下一题"}
              <ArrowRight size={20} />
            </button>
          </div>
        ) : (
          <div className="text-center text-xs text-ink-muted">
            选择你的答案 · 超时默认选 E
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 单人德国心脏病 ============
interface SoloHeartTableCard {
  card: HeartCard;
  owner: "me" | "ai";
}

const HEART_FRUITS: HeartFruit[] = ["apple", "banana", "cherry", "lemon"];
const SOLO_HEART_DECK_TOTAL = 56;

function getSoloHeartAITiming(difficulty: Difficulty) {
  if (difficulty === "easy") {
    return { flipMin: 1200, flipMax: 2500, ringMin: 1200, ringMax: 2500, mistakeChance: 0.25 };
  }
  if (difficulty === "hard" || difficulty === "nightmare") {
    return { flipMin: 500, flipMax: 1200, ringMin: 500, ringMax: 1200, mistakeChance: 0.05 };
  }
  return { flipMin: 800, flipMax: 1800, ringMin: 800, ringMax: 1800, mistakeChance: 0.12 };
}

function getSoloHeartPenaltyCards(difficulty: Difficulty): number {
  return (difficulty === "hard" || difficulty === "nightmare") ? 2 : 1;
}

/** 生成混合水果牌堆（根据难度），逻辑与后端 generateHeartDeck 一致 */
function generateSoloHeartDeck(difficulty: Difficulty): HeartCard[] {
  let minFruitTypes = 1, maxFruitTypes = 2;
  let minFruitsOnCard = 1, maxFruitsOnCard = 4;
  let deckSize = SOLO_HEART_DECK_TOTAL;
  if (difficulty === "normal") {
    minFruitTypes = 2; maxFruitTypes = 3;
    minFruitsOnCard = 2; maxFruitsOnCard = 4;
  } else if (difficulty === "hard" || difficulty === "nightmare") {
    minFruitTypes = 2; maxFruitTypes = 4;
    minFruitsOnCard = 3; maxFruitsOnCard = 4;
  }

  const deck: HeartCard[] = [];
  const makeRandomCard = (): HeartCard => {
    const numTypes = minFruitTypes + Math.floor(Math.random() * (maxFruitTypes - minFruitTypes + 1));
    const shuffled = [...HEART_FRUITS].sort(() => Math.random() - 0.5);
    const chosenFruits = shuffled.slice(0, numTypes);
    const items: import("@/lib/types").HeartFruitItem[] = [];
    // 每张牌水果总数上限 4，每个水果也最多 4 个
    let remaining = Math.min(4, minFruitsOnCard + Math.floor(Math.random() * (maxFruitsOnCard - minFruitsOnCard + 1)));
    for (let i = 0; i < chosenFruits.length; i++) {
      const isLast = i === chosenFruits.length - 1;
      const maxHere = isLast ? remaining : Math.max(1, Math.min(4, remaining - (chosenFruits.length - i - 1)));
      const minHere = isLast ? remaining : 1;
      const c = Math.min(4, minHere + Math.floor(Math.random() * (maxHere - minHere + 1)));
      items.push({ fruit: chosenFruits[i], count: c });
      remaining -= c;
    }
    return { fruits: items };
  };

  for (let i = 0; i < deckSize; i++) {
    deck.push(makeRandomCard());
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** 计算桌面水果总数 */
function getSoloHeartFruitSums(table: SoloHeartTableCard[]): Record<HeartFruit, number> {
  const sums: Record<HeartFruit, number> = { apple: 0, banana: 0, cherry: 0, lemon: 0 };
  for (const item of table) {
    for (const fi of item.card.fruits) {
      sums[fi.fruit] += fi.count;
    }
  }
  return sums;
}

/** 判断桌面上是否有任意水果总数恰好为 5 */
function hasSoloHeartFruitFive(table: SoloHeartTableCard[]): boolean {
  const sums = getSoloHeartFruitSums(table);
  return (Object.values(sums) as number[]).some((s) => s === 5);
}

function SoloHeartAttack() {
  const navigate = useNavigate();
  const { sfxEnabled } = useAudioStore();

  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  const [stage, setStage] = useState<"intro" | "playing" | "result">("intro");
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const diffCfg = getDifficultyConfig(difficulty);
  const [myDeck, setMyDeck] = useState<HeartCard[]>([]);
  const [aiDeck, setAiDeck] = useState<HeartCard[]>([]);
  const [myWon, setMyWon] = useState(0);
  const [aiWon, setAiWon] = useState(0);
  const [table, setTable] = useState<SoloHeartTableCard[]>([]);
  const [currentTurn, setCurrentTurn] = useState<"me" | "ai">("me");
  const [totalFlipped, setTotalFlipped] = useState(0);
  const [resultFlash, setResultFlash] = useState<{ type: "correct" | "wrong"; by: "me" | "ai"; penaltyCards?: number } | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: "me" | "ai" | "draw"; myWon: number; aiWon: number } | null>(null);
  const [newCardIdx, setNewCardIdx] = useState<number>(-1);

  const aiFlipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiRingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<SoloHeartTableCard[]>([]);
  const gameOverRef = useRef<boolean>(false);
  const myWonRef = useRef<number>(0);
  const aiWonRef = useRef<number>(0);
  const myDeckRef = useRef<HeartCard[]>([]);
  const aiDeckRef = useRef<HeartCard[]>([]);

  useEffect(() => { tableRef.current = table; }, [table]);
  useEffect(() => { gameOverRef.current = !!gameOver; }, [gameOver]);
  useEffect(() => { myWonRef.current = myWon; }, [myWon]);
  useEffect(() => { aiWonRef.current = aiWon; }, [aiWon]);
  useEffect(() => { myDeckRef.current = myDeck; }, [myDeck]);
  useEffect(() => { aiDeckRef.current = aiDeck; }, [aiDeck]);

  const clearAiTimers = useCallback(() => {
    if (aiFlipTimerRef.current) { clearTimeout(aiFlipTimerRef.current); aiFlipTimerRef.current = null; }
    if (aiRingTimerRef.current) { clearTimeout(aiRingTimerRef.current); aiRingTimerRef.current = null; }
  }, []);

  useEffect(() => {
    return () => {
      clearAiTimers();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (newCardTimerRef.current) clearTimeout(newCardTimerRef.current);
    };
  }, [clearAiTimers]);

  const showFlash = useCallback((type: "correct" | "wrong", by: "me" | "ai", penaltyCards?: number) => {
    setResultFlash({ type, by, penaltyCards });
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setResultFlash(null);
      flashTimerRef.current = null;
    }, 1800);
  }, []);

  const checkAndSetGameOver = useCallback((
    md: HeartCard[], ad: HeartCard[], mw: number, aw: number, tbl: SoloHeartTableCard[]
  ): { winner: "me" | "ai" | "draw"; myWon: number; aiWon: number } | null => {
    // 任一方牌堆为空即结束
    const anyEmpty = md.length === 0 || ad.length === 0;
    if (anyEmpty) {
      let winner: "me" | "ai" | "draw" = "draw";
      if (mw > aw) winner = "me";
      else if (aw > mw) winner = "ai";
      const result = { winner, myWon: mw, aiWon: aw };
      setGameOver(result);
      setStage("result");
      return result;
    }
    return null;
  }, []);

  const startGame = useCallback(() => {
    clearAiTimers();
    const fullDeck = generateSoloHeartDeck(difficulty);
    const half = Math.floor(fullDeck.length / 2);
    setMyDeck(fullDeck.slice(0, half));
    setAiDeck(fullDeck.slice(half));
    setMyWon(0);
    setAiWon(0);
    setTable([]);
    setCurrentTurn("me");
    setTotalFlipped(0);
    setResultFlash(null);
    setGameOver(null);
    setNewCardIdx(-1);
    setStage("playing");
    playSfx(sfx.click);
  }, [difficulty, playSfx, clearAiTimers]);

  const handleFlip = useCallback(() => {
    if (currentTurn !== "me" || myDeck.length === 0 || gameOver) return;
    playSfx(sfx.click);
    const newDeck = [...myDeck];
    const card = newDeck.pop()!;
    const newTable = [...table, { card, owner: "me" as const }];
    setMyDeck(newDeck);
    setTable(newTable);
    setTotalFlipped((n) => n + 1);
    setNewCardIdx(newTable.length - 1);
    if (newCardTimerRef.current) clearTimeout(newCardTimerRef.current);
    newCardTimerRef.current = setTimeout(() => setNewCardIdx(-1), 400);

    const over = checkAndSetGameOver(newDeck, aiDeck, myWon, aiWon, newTable);
    if (over) {
      playSfx(over.winner === "me" ? sfx.win : over.winner === "ai" ? sfx.lose : sfx.roundEnd);
      return;
    }

    if (aiDeck.length > 0) {
      setCurrentTurn("ai");
    } else if (newDeck.length > 0) {
      setCurrentTurn("me");
    } else {
      setCurrentTurn("ai");
    }
  }, [currentTurn, myDeck, aiDeck, table, gameOver, myWon, aiWon, playSfx, checkAndSetGameOver]);

  const doAiFlip = useCallback(() => {
    setAiDeck((prevAiDeck) => {
      if (prevAiDeck.length === 0) {
        setMyDeck((curMy) => {
          setCurrentTurn(curMy.length > 0 ? "me" : "ai");
          return curMy;
        });
        return prevAiDeck;
      }
      const newAiDeck = [...prevAiDeck];
      const card = newAiDeck.pop()!;
      setTable((prevTable) => {
        const newTable = [...prevTable, { card, owner: "ai" as const }];
        setNewCardIdx(newTable.length - 1);
        if (newCardTimerRef.current) clearTimeout(newCardTimerRef.current);
        newCardTimerRef.current = setTimeout(() => setNewCardIdx(-1), 400);
        setTotalFlipped((n) => n + 1);
        setMyDeck((curMy) => {
          setMyWon((mw) => {
            setAiWon((aw) => {
              const over = checkAndSetGameOver(curMy, newAiDeck, mw, aw, newTable);
              if (over) {
                playSfx(over.winner === "me" ? sfx.win : over.winner === "ai" ? sfx.lose : sfx.roundEnd);
              }
              return aw;
            });
            return mw;
          });
          return curMy;
        });
        if (newAiDeck.length === 0) {
          setMyDeck((curMy) => {
            setCurrentTurn(curMy.length > 0 ? "me" : "ai");
            return curMy;
          });
        } else {
          setCurrentTurn("me");
        }
        return newTable;
      });
      return newAiDeck;
    });
  }, [checkAndSetGameOver, playSfx]);

  const doAiRing = useCallback(() => {
    const curTable = tableRef.current;
    if (!hasSoloHeartFruitFive(curTable)) return;
    const wonCount = curTable.length;
    showFlash("correct", "ai");
    playSfx(sfx.correct);
    setTable([]);
    setAiWon((prevAw) => {
      const newAw = prevAw + wonCount;
      setMyDeck((curMy) => {
        setAiDeck((curAi) => {
          const over = checkAndSetGameOver(curMy, curAi, myWonRef.current, newAw, []);
          if (over) {
            playSfx(over.winner === "me" ? sfx.win : over.winner === "ai" ? sfx.lose : sfx.roundEnd);
          }
          if (curMy.length > 0) setCurrentTurn("me");
          else if (curAi.length > 0) setCurrentTurn("ai");
          return curAi;
        });
        return curMy;
      });
      return newAw;
    });
  }, [showFlash, playSfx, checkAndSetGameOver]);

  const doAiWrongRing = useCallback(() => {
    if (gameOverRef.current) return;
    if (hasSoloHeartFruitFive(tableRef.current)) return;
    playSfx(sfx.wrong);
    const penalty = getSoloHeartPenaltyCards(difficulty);
    showFlash("wrong", "ai", penalty);

    let newAd = [...aiDeckRef.current];
    const penaltyCards: HeartCard[] = [];
    for (let i = 0; i < penalty; i++) {
      if (newAd.length > 0) {
        penaltyCards.push(newAd.pop()!);
      }
    }
    const newMd = [...penaltyCards, ...myDeckRef.current];
    setMyDeck(newMd);
    setAiDeck(newAd);
    setMyWon((mw) => {
      setAiWon((aw) => {
        const over = checkAndSetGameOver(newMd, newAd, mw, aw, tableRef.current);
        if (over) {
          playSfx(over.winner === "me" ? sfx.win : over.winner === "ai" ? sfx.lose : sfx.roundEnd);
        }
        return aw;
      });
      return mw;
    });
  }, [difficulty, playSfx, showFlash, checkAndSetGameOver]);

  useEffect(() => {
    if (stage !== "playing" || gameOver) return;
    clearAiTimers();

    const timing = getSoloHeartAITiming(difficulty);
    const AUTO_FLIP_MS = 3000;

    if (hasSoloHeartFruitFive(table)) {
      let delay = timing.ringMin + Math.random() * (timing.ringMax - timing.ringMin);
      if (Math.random() < timing.mistakeChance) delay *= 2.0;
      aiRingTimerRef.current = setTimeout(() => {
        doAiRing();
      }, delay);
    } else {
      if (Math.random() < timing.mistakeChance * 0.3 && table.length >= 3) {
        const wrongDelay = 600 + Math.random() * 900;
        aiRingTimerRef.current = setTimeout(() => doAiWrongRing(), wrongDelay);
      }
      // 自动翻牌：双方均 3 秒自动翻一张
      if (currentTurn === "ai" && aiDeck.length > 0) {
        aiFlipTimerRef.current = setTimeout(() => {
          doAiFlip();
        }, AUTO_FLIP_MS);
      } else if (currentTurn === "me" && myDeck.length > 0) {
        aiFlipTimerRef.current = setTimeout(() => {
          handleFlip();
        }, AUTO_FLIP_MS);
      } else if (currentTurn === "me" && myDeck.length === 0 && aiDeck.length > 0) {
        // 我的牌堆空了，切换到 AI 继续
        setCurrentTurn("ai");
      } else if (currentTurn === "ai" && aiDeck.length === 0 && myDeck.length > 0) {
        // AI 的牌堆空了，切换到我继续
        setCurrentTurn("me");
      }
    }
  }, [table, currentTurn, stage, gameOver, aiDeck.length, myDeck.length, difficulty, clearAiTimers, doAiFlip, doAiRing, doAiWrongRing, handleFlip]);

  const handleRing = useCallback(() => {
    if (gameOver) return;
    playSfx(sfx.click);
    clearAiTimers();

    const isCorrect = hasSoloHeartFruitFive(table);
    const penaltyCards = getSoloHeartPenaltyCards(difficulty);

    if (isCorrect) {
      const wonCount = table.length;
      showFlash("correct", "me");
      playSfx(sfx.correct);
      const newMw = myWon + wonCount;
      setMyWon(newMw);
      setTable([]);
      setCurrentTurn("ai");
      const over = checkAndSetGameOver(myDeck, aiDeck, newMw, aiWon, []);
      if (over) {
        playSfx(over.winner === "me" ? sfx.win : over.winner === "ai" ? sfx.lose : sfx.roundEnd);
      }
    } else {
      showFlash("wrong", "me", penaltyCards);
      playSfx(sfx.wrong);
      let newMyDeck = [...myDeck];
      let newAiDeck = [...aiDeck];
      let given = 0;
      for (let i = 0; i < penaltyCards; i++) {
        if (newMyDeck.length > 0) {
          const card = newMyDeck.pop()!;
          newAiDeck = [card, ...newAiDeck];
          given++;
        }
      }
      setMyDeck(newMyDeck);
      setAiDeck(newAiDeck);
      if (currentTurn === "me" && newMyDeck.length === 0 && newAiDeck.length > 0) {
        setCurrentTurn("ai");
      }
      const over = checkAndSetGameOver(newMyDeck, newAiDeck, myWon, aiWon, table);
      if (over) {
        playSfx(over.winner === "me" ? sfx.win : over.winner === "ai" ? sfx.lose : sfx.roundEnd);
      }
    }
  }, [gameOver, table, myDeck, aiDeck, myWon, aiWon, currentTurn, difficulty, playSfx, clearAiTimers, showFlash, checkAndSetGameOver]);

  const DIFF_LABEL: Record<string, string> = { easy: "简单", normal: "中等", hard: "困难", nightmare: "噩梦" };

  /* ============ 介绍页 ============ */
  if (stage === "intro") {
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative select-none">
        <div className="absolute top-10 left-5 text-6xl animate-float opacity-20">🔔</div>
        <div className="absolute top-20 right-5 text-5xl animate-float opacity-20" style={{ animationDelay: "1s" }}>🍎</div>
        <div className="absolute bottom-20 left-8 text-5xl animate-float opacity-20" style={{ animationDelay: "2s" }}>🍋</div>
        <div className="absolute bottom-32 right-10 text-4xl animate-float opacity-20" style={{ animationDelay: "0.5s" }}>🍒</div>

        <div className="w-full max-w-md flex flex-col items-center relative z-10">
          <div className="mt-8 mb-2 text-center animate-bounce-in">
            <h1 className="font-display text-5xl text-ink leading-tight">德国心脏病 · 单人</h1>
            <div className="mt-1 flex items-center justify-center gap-2">
              <div className="h-1 w-16 bg-sun rounded-full" />
              <Bell size={20} className="text-sun" />
              <div className="h-1 w-16 bg-sun rounded-full" />
            </div>
            <p className="font-body text-ink-muted text-sm mt-3">
              对战 AI · 混合水果 · 凑齐 5 个拍铃
            </p>
          </div>

          <div className="w-full bg-white rounded-blob shadow-card border-3 border-ink p-6 mt-6 animate-slide-up">
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-3 bg-mint/30 rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-sun border-2 border-ink font-display text-ink">1</div>
                <div className="flex-1">
                  <div className="font-display text-ink">自动翻牌</div>
                  <div className="text-xs text-ink-muted">每 3 秒自动翻一张牌到桌面，牌含混合水果</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-sun/40 rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-ink border-2 border-ink font-display text-cream">2</div>
                <div className="flex-1">
                  <div className="font-display text-ink">抢拍铃铛</div>
                  <div className="text-xs text-ink-muted">桌面任一水果总数 = 5 时拍铃，赢得桌面所有牌</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-coral-light rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-coral border-2 border-ink font-display text-white">3</div>
                <div className="flex-1">
                  <div className="font-display text-ink">分出胜负</div>
                  <div className="text-xs text-ink-muted">牌堆耗尽时牌多者胜；拍错给对手牌（困难罚 2 张）</div>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <p className="font-display text-ink text-sm mb-2">难度选择</p>
              <div className="grid grid-cols-3 gap-2">
                {(["easy", "normal", "hard"] as Difficulty[]).map((d) => {
                  const cfg = getDifficultyConfig(d);
                  return (
                    <button
                      key={d}
                      onClick={() => { setDifficulty(d); playSfx(sfx.uiTick); }}
                      className={`py-2.5 rounded-doodle border-2 font-display text-sm transition-all flex flex-col items-center gap-0.5 ${
                        difficulty === d
                          ? `${cfg.color} border-ink shadow-soft`
                          : "bg-white text-ink border-ink/30"
                      }`}
                    >
                      <span>{cfg.icon}</span>
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-xs text-ink-muted mt-2">
                {difficulty === "easy" && "1-2种水果/牌 · AI反应较慢"}
                {difficulty === "normal" && "2-3种水果/牌 · AI反应适中"}
                {difficulty === "hard" && "2-4种水果/牌 · AI反应快 · 拍错罚2张"}
              </p>
            </div>

            <button
              onClick={startGame}
              className="btn-press w-full py-4 bg-gradient-to-b from-yellow-300 to-yellow-500 text-ink font-display text-xl rounded-2xl shadow-pop border-[3px] border-ink flex items-center justify-center gap-2"
            >
              <Bell size={22} />
              开始挑战
            </button>
            <button
              onClick={() => { playSfx(sfx.click); navigate("/"); }}
              className="btn-press w-full py-2 mt-3 text-ink-muted font-body text-sm"
            >
              ← 返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ============ 结果页 ============ */
  if (stage === "result" && gameOver) {
    const won = gameOver.winner === "me";
    const isDraw = gameOver.winner === "draw";
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8 relative">
        {won && <div className="absolute inset-0 pointer-events-none"><Confetti /></div>}
        <div className="w-full max-w-md bg-white rounded-blob shadow-card border-3 border-ink p-6 text-center animate-bounce-in relative z-10">
          <div className="text-6xl mb-3 animate-float">{won ? "🏆" : isDraw ? "🤝" : "😅"}</div>
          <h2 className={`font-display text-3xl mb-1 ${won ? "text-mint" : isDraw ? "text-sun" : "text-coral"}`}>
            {won ? "你赢了！" : isDraw ? "平局！" : "你输了"}
          </h2>
          <p className="font-body text-ink-muted text-sm mb-1">
            难度：{diffCfg.icon} {DIFF_LABEL[difficulty]}
          </p>
          <p className="font-body text-ink-muted text-sm mb-4">
            {won ? "眼疾手快！" : isDraw ? "势均力敌" : "再来一局？"}
          </p>

          <div className="bg-cream rounded-doodle border-2 border-ink p-4 mb-4">
            <div className="flex items-center gap-1.5 mb-2 justify-center">
              <Trophy size={14} className="text-sun" />
              <span className="font-display text-ink text-xs">最终赢牌数</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                <div className="text-[10px] text-ink-muted mb-1 font-display">我</div>
                <div className="font-display text-4xl text-mint">{myWon}</div>
              </div>
              <div className="font-display text-3xl text-ink-muted px-3">VS</div>
              <div className="text-center flex-1">
                <div className="text-[10px] text-ink-muted mb-1 font-display">AI</div>
                <div className="font-display text-4xl text-coral">{aiWon}</div>
              </div>
            </div>
          </div>

          <button
            onClick={startGame}
            className="btn-press w-full py-4 bg-gradient-to-b from-yellow-300 to-yellow-500 text-ink font-display text-xl rounded-2xl shadow-pop border-[3px] border-ink flex items-center justify-center gap-2 mb-3"
          >
            <RotateCcw size={22} />
            再来一局
          </button>
          <button
            onClick={() => { playSfx(sfx.click); navigate("/"); }}
            className="btn-press w-full py-3 bg-white text-ink font-display text-lg rounded-2xl border-[3px] border-ink shadow-soft flex items-center justify-center gap-2"
          >
            <Home size={20} />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  /* ============ 游戏中 ============ */
  const canRing = hasSoloHeartFruitFive(table) && table.length > 0;
  const canFlip = currentTurn === "me" && myDeck.length > 0 && !gameOver;
  const myNickname = "我";
  const aiNickname = "AI";

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden select-none">
      <style>{`
        @keyframes flipIn {
          0% { transform: rotateY(90deg) scale(0.8); opacity: 0; }
          100% { transform: rotateY(0) scale(1); opacity: 1; }
        }
        @keyframes shakeBell {
          0%,100% { transform: rotate(0); }
          20% { transform: rotate(-20deg); }
          40% { transform: rotate(15deg); }
          60% { transform: rotate(-10deg); }
          80% { transform: rotate(5deg); }
        }
      `}</style>

      {/* 顶部栏 */}
      <div className="flex-shrink-0 px-3 py-2 flex items-center justify-between bg-white/60 border-b-2 border-ink/10">
        <button onClick={() => { playSfx(sfx.click); navigate("/"); }} className="btn-press bg-white border-2 border-ink rounded-full px-3 py-1 font-display text-xs flex items-center gap-1 shadow-soft">
          <Home size={14} />
          退出
        </button>
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5">
            <span className="text-lg">🔔</span>
            <span className="font-display text-ink text-sm font-bold">德国心脏病</span>
            <span className={`font-display text-[10px] px-1.5 py-0.5 rounded-full border border-ink ${diffCfg.color}`}>
              {DIFF_LABEL[difficulty]}
            </span>
          </div>
        </div>
        <div className="font-display text-[10px] text-ink-muted bg-white rounded-full px-2 py-1 border border-ink/20">
          已翻 {totalFlipped}
        </div>
      </div>

      {/* 主区域 */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* AI栏 - pt-3 给头像跳跃留出空间 */}
        <div className="flex-shrink-0 px-3 pt-3 pb-1 flex items-center justify-between">
          <div className="flex flex-col items-center gap-1 relative">
            <div className={`relative ${currentTurn === "ai" ? "animate-bounce" : ""}`}>
              <div className={`w-14 h-14 rounded-full bg-coral/20 border-[3px] border-ink shadow-card flex items-center justify-center font-display text-xl text-ink`}>
                AI
              </div>
              {aiWon > 0 && (
                <div className="absolute -bottom-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-ink text-white font-display text-xs flex items-center justify-center border-2 border-white shadow">
                  {aiWon}
                </div>
              )}
            </div>
            <span className="font-display text-xs text-coral max-w-[64px] truncate">AI对手</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xs text-ink-muted">{aiDeck.length}</span>
            <CardBack count={aiDeck.length} size="md" highlight={currentTurn === "ai"} />
          </div>
        </div>

        {/* 桌面牌区 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          <div className="w-full h-full flex flex-wrap gap-2 justify-center content-start">
            {table.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center text-ink-muted font-display text-sm">
                  <Bell size={32} className="mx-auto mb-2 opacity-30" />
                  <p>等待翻牌...</p>
                  <p className="text-[10px] mt-1">某水果凑齐 5 个时赶紧拍铃！</p>
                </div>
              </div>
            ) : (
              table.map((tc, idx) => (
                <div key={idx} className="flex flex-col items-center gap-0.5">
                  <HeartCardView
                    card={tc.card}
                    isNew={idx === newCardIdx}
                    ownerSide={tc.owner === "me" ? "me" : "opp"}
                  />
                  <span className={`text-[9px] font-display ${tc.owner === "me" ? "text-mint" : "text-coral"}`}>
                    {tc.owner === "me" ? myNickname : aiNickname}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 我的栏 */}
        <div className="flex-shrink-0 px-3 py-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardBack count={myDeck.length} size="md" highlight={canFlip} onClick={canFlip ? handleFlip : undefined} />
            <span className="font-display text-xs text-ink-muted">{myDeck.length}</span>
          </div>
          <div className="flex flex-col items-center gap-1 relative">
            <div className={`relative ${currentTurn === "me" ? "animate-bounce" : ""}`}>
              <div className={`w-14 h-14 rounded-full bg-mint border-[3px] border-ink shadow-card flex items-center justify-center font-display text-xl text-ink`}>
                我
              </div>
              <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 rounded-full bg-mint border-2 border-white" />
              {myWon > 0 && (
                <div className="absolute -bottom-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-ink text-white font-display text-xs flex items-center justify-center border-2 border-white shadow">
                  {myWon}
                </div>
              )}
            </div>
            <span className="font-display text-xs text-mint max-w-[64px] truncate">我</span>
          </div>
        </div>
      </div>

      {/* 结果提示 */}
      {resultFlash && (
        <div className="flex-shrink-0 px-4 pb-1 animate-bounce-in">
          <div
            className={`rounded-2xl border-[3px] border-ink px-4 py-2 text-center font-display text-sm shadow-pop ${
              resultFlash.type === "correct"
                ? resultFlash.by === "me" ? "bg-mint text-ink" : "bg-coral/80 text-white"
                : "bg-coral text-white"
            }`}
          >
            {resultFlash.type === "correct" ? (
              <>🔔 {resultFlash.by === "me" ? "你" : "AI"} 拍铃正确，赢得桌面所有牌！</>
            ) : (
              <>❌ {resultFlash.by === "me" ? "你" : "AI"} 拍错了，给对手 {resultFlash.penaltyCards ?? 1} 张牌</>
            )}
          </div>
        </div>
      )}

      {/* 底部拍铃区 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink/10 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {/* 自动翻牌提示 */}
        <div className="text-center text-[11px] text-ink-muted mb-2 font-body">
          {gameOver ? "游戏结束" : canRing ? "🔔 水果凑齐 5 个！快拍！" : currentTurn === "me" ? "⏰ 3 秒后自动翻你的牌" : "⏰ 3 秒后自动翻 AI 的牌"}
        </div>
        {/* 大拍铃按钮 */}
        <button
          onClick={handleRing}
          disabled={table.length === 0 || !!gameOver}
          className={`btn-press w-full h-16 rounded-full border-[3px] border-ink font-display text-xl flex items-center justify-center gap-2 shadow-pop transition-all ${
            canRing
              ? "bg-gradient-to-b from-yellow-300 to-yellow-500 text-ink animate-pulse"
              : "bg-gradient-to-b from-yellow-200 to-yellow-400 text-ink/80"
          } disabled:opacity-50`}
          style={canRing ? { animation: "shakeBell 0.5s infinite" } : undefined}
        >
          <Bell size={28} />
          拍铃
        </button>
      </div>
    </div>
  );
}

// ============ 单人合作画画 ============
const SOLO_COOP_DRAW_TIME = 90;
const SOLO_COOP_CANVAS_W = 600;
const SOLO_COOP_CANVAS_H = 450;
const SOLO_COOP_EXPORT_W = 400;
const SOLO_COOP_EXPORT_H = 300;

const SOLO_COOP_COLORS = [
  { name: "ink", value: "#1B1340" },
  { name: "coral", value: "#FF5E5B" },
  { name: "blue", value: "#3B82F6" },
  { name: "green", value: "#3DDC97" },
  { name: "yellow", value: "#FFD23F" },
];

const SOLO_COOP_BRUSH_SIZES = [
  { name: "细", value: 3 },
  { name: "中", value: 6 },
  { name: "粗", value: 12 },
];

function pickDrawingPrompt(): string {
  const arr = drawingPrompts as string[];
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 把笔画渲染成 DataURL（用于展示和下载） */
function soloCoOpStrokesToDataURL(strokes: Stroke[]): string {
  const canvas = document.createElement("canvas");
  canvas.width = SOLO_COOP_EXPORT_W;
  canvas.height = SOLO_COOP_EXPORT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, SOLO_COOP_EXPORT_W, SOLO_COOP_EXPORT_H);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokes.forEach((stroke) => {
    if (stroke.points.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = stroke.isEraser ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    const first = stroke.points[0];
    ctx.moveTo((first.x / SOLO_COOP_CANVAS_W) * SOLO_COOP_EXPORT_W, (first.y / SOLO_COOP_CANVAS_H) * SOLO_COOP_EXPORT_H);
    if (stroke.points.length === 1) {
      ctx.arc(
        (first.x / SOLO_COOP_CANVAS_W) * SOLO_COOP_EXPORT_W,
        (first.y / SOLO_COOP_CANVAS_H) * SOLO_COOP_EXPORT_H,
        stroke.size / 2,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = stroke.color;
      ctx.fill();
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(
          (stroke.points[i].x / SOLO_COOP_CANVAS_W) * SOLO_COOP_EXPORT_W,
          (stroke.points[i].y / SOLO_COOP_CANVAS_H) * SOLO_COOP_EXPORT_H
        );
      }
      ctx.stroke();
    }
    ctx.restore();
  });
  return canvas.toDataURL("image/png");
}

function SoloCoOpDrawing() {
  const navigate = useNavigate();
  const { sfxEnabled } = useAudioStore();

  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  const [stage, setStage] = useState<"intro" | "drawing" | "rating" | "result">("intro");
  const [prompt, setPrompt] = useState("");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(SOLO_COOP_COLORS[0].value);
  const [brushSize, setBrushSize] = useState(SOLO_COOP_BRUSH_SIZES[1].value);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [timeLeft, setTimeLeft] = useState(SOLO_COOP_DRAW_TIME);
  const [rating, setRating] = useState(0); // 1-5 星
  const [finalImage, setFinalImage] = useState("");
  const lastSecRef = useRef<number>(-1);
  const strokesRef = useRef<Stroke[]>([]);

  const startCoOp = () => {
    setPrompt(pickDrawingPrompt());
    setOrientation("landscape");
    setStrokes([]);
    strokesRef.current = [];
    setColor(SOLO_COOP_COLORS[0].value);
    setBrushSize(SOLO_COOP_BRUSH_SIZES[1].value);
    setTool("pen");
    setTimeLeft(SOLO_COOP_DRAW_TIME);
    setRating(0);
    setFinalImage("");
    setStage("drawing");
    playSfx(sfx.click);
  };

  const handleStrokesChange = useCallback((s: Stroke[]) => {
    setStrokes(s);
    strokesRef.current = s;
  }, []);

  // 倒计时驱动
  useEffect(() => {
    if (stage !== "drawing") return;
    const start = Date.now();
    setTimeLeft(SOLO_COOP_DRAW_TIME);
    lastSecRef.current = Math.ceil(SOLO_COOP_DRAW_TIME);
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, SOLO_COOP_DRAW_TIME - elapsed);
      setTimeLeft(left);
      const sec = Math.ceil(left);
      if (sec !== lastSecRef.current && sec > 0) {
        lastSecRef.current = sec;
        if (left <= 3 && left > 0) {
          playSfx(sfx.tickUrgent);
        } else if (sec % 10 === 0) {
          playSfx(sfx.tick);
        }
      }
      if (left <= 0) {
        clearInterval(interval);
        finishDrawing();
      }
    }, 100);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, playSfx]);

  const finishDrawing = () => {
    const currentStrokes = canvasRef.current?.getStrokes() ?? strokesRef.current;
    strokesRef.current = currentStrokes;
    const img = soloCoOpStrokesToDataURL(currentStrokes);
    setFinalImage(img);
    setStage("rating");
    playSfx(sfx.roundEnd);
  };

  const handleFinish = () => {
    playSfx(sfx.click);
    finishDrawing();
  };

  const submitRating = (stars: number) => {
    setRating(stars);
    playSfx(sfx.click);
  };

  const handleDone = () => {
    setStage("result");
    playSfx(sfx.win);
  };

  const handleDownload = () => {
    playSfx(sfx.click);
    if (!finalImage) return;
    const a = document.createElement("a");
    a.href = finalImage;
    a.download = `单人画画_${prompt || "作品"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /* ============ 介绍页 ============ */
  if (stage === "intro") {
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative">
        <div className="absolute top-10 left-5 text-6xl animate-float opacity-20">✏️</div>
        <div className="absolute top-20 right-5 text-5xl animate-float opacity-20" style={{ animationDelay: "1s" }}>🎨</div>
        <div className="absolute bottom-20 left-8 text-5xl animate-float opacity-20" style={{ animationDelay: "2s" }}>⭐</div>

        <div className="w-full max-w-md flex flex-col items-center relative z-10">
          <div className="mt-8 mb-2 text-center animate-bounce-in">
            <h1 className="font-display text-5xl text-ink leading-tight">合作画画 · 单人游玩</h1>
            <div className="mt-1 flex items-center justify-center gap-2">
              <div className="h-1 w-16 bg-sun rounded-full" />
              <Pencil size={20} className="text-sun" />
              <div className="h-1 w-16 bg-sun rounded-full" />
            </div>
            <p className="font-body text-ink-muted text-sm mt-3">
              单人游玩：合作画画 · 不需要联网 · 命题作画 + 自我评分
            </p>
          </div>

          <div className="w-full bg-white rounded-blob shadow-card border-3 border-ink p-6 mt-6 animate-slide-up">
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-3 bg-sun rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-coral border-2 border-ink font-display text-white">1</div>
                <div className="flex-1">
                  <div className="font-display text-ink">随机命题</div>
                  <div className="text-xs text-ink-muted">系统抽一个有趣的命题</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-mint rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-ink border-2 border-ink font-display text-cream">2</div>
                <div className="flex-1">
                  <div className="font-display text-ink">画 90 秒</div>
                  <div className="text-xs text-ink-muted">用画板尽情创作，可换色/橡皮/撤销</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-coral-light rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-mint border-2 border-ink font-display text-ink">3</div>
                <div className="flex-1">
                  <div className="font-display text-ink">自我评分</div>
                  <div className="text-xs text-ink-muted">1-5 星，诚信打分，可下载画作</div>
                </div>
              </div>
            </div>

            <button
              onClick={startCoOp}
              className="btn-press w-full py-4 bg-sun text-ink font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2"
            >
              <Pencil size={22} />
              开始作画
            </button>
            <button
              onClick={() => {
                playSfx(sfx.click);
                navigate("/");
              }}
              className="btn-press w-full py-2 mt-3 text-ink-muted font-body text-sm"
            >
              ← 返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ============ 评分页 ============ */
  if (stage === "rating") {
    const labels = ["", "需要加油", "还行", "不错", "挺好看", "神作！"];
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-4 animate-bounce-in">
            <div className="text-5xl mb-2 animate-float">🎨</div>
            <h1 className="font-display text-3xl text-ink">画作完成！</h1>
            <p className="text-ink-muted text-sm mt-1">命题：{prompt}</p>
          </div>

          <div className="bg-white rounded-doodle border-3 border-ink shadow-card p-2 mb-4">
            {finalImage ? (
              <img
                src={finalImage}
                alt="我的画作"
                className="w-full rounded-doodle bg-white"
                style={{ aspectRatio: "4 / 3" }}
              />
            ) : (
              <div className="w-full aspect-[4/3] bg-white rounded-doodle flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-ink-muted" />
              </div>
            )}
          </div>

          <div className="bg-white rounded-blob border-2 border-ink shadow-soft p-4 mb-4 text-center">
            <p className="text-xs text-ink-muted mb-2 flex items-center justify-center gap-1">
              <Sparkles size={14} className="text-sun" />
              给自己的画作打分
            </p>
            <div className="flex items-center justify-center gap-2 mb-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => submitRating(s)}
                  className={`btn-press w-12 h-12 rounded-doodle border-2 font-display text-2xl flex items-center justify-center transition-all ${
                    rating >= s
                      ? "bg-sun text-ink border-ink shadow-soft"
                      : "bg-white text-ink-muted border-ink/30"
                  }`}
                >
                  ⭐
                </button>
              ))}
            </div>
            <p className="font-display text-lg text-coral">
              {rating > 0 ? `${rating} 星 · ${labels[rating]}` : "请选择评分"}
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleDownload}
              className="btn-press w-full py-3 bg-mint text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
            >
              <Download size={20} />
              下载画作
            </button>
            <button
              onClick={handleDone}
              disabled={rating === 0}
              className="btn-press w-full py-3 bg-coral text-white font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Check size={20} />
              完成评分
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ============ 结果页 ============ */
  if (stage === "result") {
    const labels = ["", "需要加油", "还行", "不错", "挺好看", "神作！"];
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-md bg-white rounded-blob shadow-card border-3 border-ink p-6 text-center animate-bounce-in">
          <div className="text-6xl mb-3 animate-float">⭐</div>
          <h2 className="font-display text-3xl text-ink mb-1">大作诞生！</h2>
          <p className="font-body text-ink-muted text-sm mb-4">命题：{prompt}</p>

          <div className="bg-white rounded-doodle border-3 border-ink shadow-card p-2 mb-4">
            {finalImage ? (
              <img
                src={finalImage}
                alt="我的画作"
                className="w-full rounded-doodle bg-white"
                style={{ aspectRatio: "4 / 3" }}
              />
            ) : (
              <div className="w-full aspect-[4/3] bg-cream-dark rounded-doodle" />
            )}
          </div>

          <div className="bg-cream rounded-doodle border-2 border-ink p-4 mb-6">
            <p className="text-xs text-ink-muted mb-1">自我评分</p>
            <div className="font-display text-5xl text-coral mb-1">
              {"⭐".repeat(rating)}
              <span className="text-ink-muted/30">{"⭐".repeat(5 - rating)}</span>
            </div>
            <p className="font-display text-lg text-coral">{labels[rating]}</p>
          </div>

          <button
            onClick={startCoOp}
            className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2 mb-3"
          >
            <RotateCcw size={22} />
            再画一幅
          </button>
          <button
            onClick={() => {
              playSfx(sfx.click);
              navigate("/");
            }}
            className="btn-press w-full py-3 bg-white text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
          >
            <Home size={20} />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  /* ============ 画图阶段 ============ */
  const aspectClass = orientation === "portrait" ? "aspect-[3/4]" : "aspect-[4/3]";
  const containerClass = orientation === "portrait" ? "w-full max-w-[280px]" : "w-full max-w-md";

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏：命题 + 倒计时 */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-ink-muted">命题</span>
          <span className="text-xs text-ink-muted">
            {orientation === "portrait" ? "竖屏画" : "横屏画"} · 单人作画
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="bg-sun text-ink font-display text-base px-3 py-1 rounded-full border-2 border-ink truncate">
            {prompt || "加载中..."}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`font-display text-xl ${timeLeft <= 10 ? "text-coral animate-pulse" : "text-ink"}`}
            >
              {Math.ceil(timeLeft)}s
            </span>
          </div>
        </div>
      </div>

      {/* 画布 */}
      <div className="flex-1 flex flex-col px-3 py-2 min-h-0">
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className={`${containerClass} ${aspectClass} bg-white rounded-doodle border-3 border-ink shadow-card overflow-hidden relative`}>
            <DrawingCanvas
              ref={canvasRef}
              strokes={strokes}
              onStrokesChange={handleStrokesChange}
              color={color}
              brushSize={brushSize}
              tool={tool}
            />
          </div>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {SOLO_COOP_COLORS.map((c) => (
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
                tool === "eraser" ? "bg-warn text-white border-ink" : "bg-white text-ink border-ink"
              }`}
            >
              {tool === "eraser" ? <Eraser size={18} /> : <Pencil size={18} />}
            </button>
            <button
              onClick={() => {
                canvasRef.current?.undo();
                playSfx(sfx.uiTick);
              }}
              className="btn-press p-2 rounded-doodle border-2 border-ink bg-white text-ink"
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={() => {
                canvasRef.current?.clear();
                playSfx(sfx.uiTick);
              }}
              className="btn-press p-2 rounded-doodle border-2 border-ink bg-white text-coral"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted font-body">粗细</span>
          {SOLO_COOP_BRUSH_SIZES.map((b) => (
            <button
              key={b.value}
              onClick={() => {
                setBrushSize(b.value);
                playSfx(sfx.uiTick);
              }}
              className={`flex-1 py-1.5 rounded-doodle border-2 font-display text-sm transition-all ${
                brushSize === b.value ? "bg-ink text-cream border-ink" : "bg-white text-ink border-ink/30"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
        <button
          onClick={handleFinish}
          className="btn-press w-full py-2.5 bg-coral text-white font-display text-base rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
        >
          <Check size={18} />
          画完了
        </button>
      </div>
    </div>
  );
}

// ============ 单人表情包猜词 ============
interface EmojiPuzzleItem {
  id: number;
  category: string;
  emoji: string;
  answer: string;
  alternatives: string[];
}
interface SoloEmojiQ {
  questionIndex: number;
  emoji: string;
  category: string;
  answer: string;
  alternatives: string[];
}
const SOLO_EMOJI_TOTAL = 10;
const SOLO_EMOJI_TIME_LIMIT = 30;
const SOLO_EMOJI_SCORE_PER = 10;
// 揭晓后多久可以点"下一题"（毫秒）
const SOLO_EMOJI_NEXT_DELAY = 1500;

/** 随机抽取指定数量的表情包谜题（Fisher-Yates 洗牌） */
function pickSoloEmojiPuzzles(count: number): SoloEmojiQ[] {
  const all = (emojiPuzzles as EmojiPuzzleItem[]).slice();
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(count, all.length)).map((p, i) => ({
    questionIndex: i,
    emoji: p.emoji,
    category: p.category,
    answer: p.answer,
    alternatives: p.alternatives || [],
  }));
}

/** 标准化字符串：小写 + 去除所有空白（与多人版规则一致） */
function normalizeEmojiAnswer(str: string): string {
  return (str || "").toLowerCase().replace(/\s+/g, "").trim();
}

/** 判断猜测是否正确：匹配 answer 或 alternatives 中任一项 */
function checkSoloEmojiGuess(guess: string, q: SoloEmojiQ): boolean {
  const g = normalizeEmojiAnswer(guess);
  if (!g) return false;
  const accepted = [q.answer, ...(q.alternatives || [])];
  return accepted.some((a) => normalizeEmojiAnswer(a) === g);
}

function SoloEmoji() {
  const navigate = useNavigate();
  const { sfxEnabled } = useAudioStore();

  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  const [stage, setStage] = useState<"intro" | "answering" | "reveal" | "result">("intro");
  const [puzzles, setPuzzles] = useState<SoloEmojiQ[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SOLO_EMOJI_TIME_LIMIT);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  // 揭晓阶段的最终答案（用于翻页后保留显示）
  const [revealInfo, setRevealInfo] = useState<{
    myGuess: string;
    correct: boolean;
  } | null>(null);
  const [canNext, setCanNext] = useState(false);
  const submittedRef = useRef(false);
  const lastSecRef = useRef<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentQ = puzzles[qIndex];

  const startEmoji = () => {
    setPuzzles(pickSoloEmojiPuzzles(SOLO_EMOJI_TOTAL));
    setQIndex(0);
    setGuess("");
    setSubmitted(false);
    setScore(0);
    setCorrectCount(0);
    setRevealInfo(null);
    setCanNext(false);
    setStage("answering");
    playSfx(sfx.click);
  };

  // 切题重置
  useEffect(() => {
    if (stage !== "answering") return;
    setGuess("");
    setSubmitted(false);
    submittedRef.current = false;
    setTimeLeft(SOLO_EMOJI_TIME_LIMIT);
    lastSecRef.current = Math.ceil(SOLO_EMOJI_TIME_LIMIT);
    setRevealInfo(null);
    setCanNext(false);
    // 自动聚焦输入框
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [qIndex, stage]);

  // 倒计时驱动答题阶段
  useEffect(() => {
    if (stage !== "answering" || !currentQ) return;
    if (submitted) return; // 已提交，停止倒计时

    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, SOLO_EMOJI_TIME_LIMIT - elapsed);
      setTimeLeft(left);
      // 滴答音效
      const sec = Math.ceil(left);
      if (sec !== lastSecRef.current && sec > 0) {
        lastSecRef.current = sec;
        if (left <= 3 && left > 0) {
          playSfx(sfx.tickUrgent);
        } else {
          playSfx(sfx.tick);
        }
      }
      // 超时自动提交空答案
      if (left <= 0 && !submittedRef.current) {
        submitGuess("");
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, qIndex, submitted, currentQ, playSfx]);

  // 揭晓阶段：延迟启用"下一题"按钮
  useEffect(() => {
    if (stage !== "reveal") return;
    setCanNext(false);
    const timer = setTimeout(() => setCanNext(true), SOLO_EMOJI_NEXT_DELAY);
    return () => clearTimeout(timer);
  }, [stage, qIndex]);

  // 提交答案
  const submitGuess = (g: string) => {
    if (!currentQ || submitted) return;
    submittedRef.current = true;
    setSubmitted(true);
    const correct = checkSoloEmojiGuess(g, currentQ);
    setRevealInfo({ myGuess: g, correct });
    if (correct) {
      setScore((s) => s + SOLO_EMOJI_SCORE_PER);
      setCorrectCount((c) => c + 1);
    }
    playSfx(correct ? sfx.correct : sfx.wrong);
    // 短暂延迟后进入揭晓阶段，给玩家看到提交反馈
    setTimeout(() => {
      setStage("reveal");
    }, 400);
  };

  const handleSubmit = () => {
    if (submitted) return;
    submitGuess(guess.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleNext = () => {
    if (!canNext) return;
    playSfx(sfx.click);
    if (qIndex + 1 >= SOLO_EMOJI_TOTAL) {
      setStage("result");
      playSfx(sfx.win);
      return;
    }
    setQIndex((i) => i + 1);
    setStage("answering");
  };

  /* ============ 介绍页 ============ */
  if (stage === "intro") {
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative">
        <div className="absolute top-10 left-5 text-6xl animate-float opacity-20">😎</div>
        <div className="absolute top-20 right-5 text-5xl animate-float opacity-20" style={{ animationDelay: "1s" }}>🤔</div>
        <div className="absolute bottom-20 left-8 text-5xl animate-float opacity-20" style={{ animationDelay: "2s" }}>💡</div>

        <div className="w-full max-w-md flex flex-col items-center relative z-10">
          <div className="mt-8 mb-2 text-center animate-bounce-in">
            <h1 className="font-display text-5xl text-ink leading-tight">表情包猜词 · 单人游玩</h1>
            <div className="mt-1 flex items-center justify-center gap-2">
              <div className="h-1 w-16 bg-coral rounded-full" />
              <Smile size={20} className="text-sun" />
              <div className="h-1 w-16 bg-coral rounded-full" />
            </div>
            <p className="font-body text-ink-muted text-sm mt-3">
              单人游玩：表情包猜词 · 不需要联网 · 共 {SOLO_EMOJI_TOTAL} 题
            </p>
          </div>

          <div className="w-full bg-white rounded-blob shadow-card border-3 border-ink p-6 mt-6 animate-slide-up">
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-3 bg-coral-light rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-coral border-2 border-ink font-display text-white">1</div>
                <div className="flex-1">
                  <div className="font-display text-ink">看 emoji 猜词</div>
                  <div className="text-xs text-ink-muted">每题 {SOLO_EMOJI_TIME_LIMIT} 秒，输入你猜的词语</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-sun rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-ink border-2 border-ink font-display text-cream">2</div>
                <div className="flex-1">
                  <div className="font-display text-ink">提交揭晓</div>
                  <div className="text-xs text-ink-muted">支持别名/英文名，不区分大小写与空格</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-mint rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-mint border-2 border-ink font-display text-ink">3</div>
                <div className="flex-1">
                  <div className="font-display text-ink">累计得分</div>
                  <div className="text-xs text-ink-muted">答对 1 题 +{SOLO_EMOJI_SCORE_PER} 分 · 满分 {SOLO_EMOJI_TOTAL * SOLO_EMOJI_SCORE_PER} 分</div>
                </div>
              </div>
            </div>

            <button
              onClick={startEmoji}
              className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2"
            >
              <Smile size={22} />
              开始猜词
            </button>
            <button
              onClick={() => {
                playSfx(sfx.click);
                navigate("/");
              }}
              className="btn-press w-full py-2 mt-3 text-ink-muted font-body text-sm"
            >
              ← 返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ============ 结果页 ============ */
  if (stage === "result") {
    const percent = Math.round((score / (SOLO_EMOJI_TOTAL * SOLO_EMOJI_SCORE_PER)) * 100);
    let grade = "";
    let gradeEmoji = "";
    if (percent >= 80) {
      grade = "表情达人";
      gradeEmoji = "🏆";
    } else if (percent >= 60) {
      grade = "猜词高手";
      gradeEmoji = "😎";
    } else if (percent >= 40) {
      grade = "还需努力";
      gradeEmoji = "🤔";
    } else {
      grade = "继续加油";
      gradeEmoji = "💪";
    }
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-md bg-white rounded-blob shadow-card border-3 border-ink p-8 text-center animate-bounce-in">
          <div className="text-6xl mb-3 animate-float">{gradeEmoji}</div>
          <h2 className="font-display text-3xl text-coral mb-1">{grade}</h2>
          <p className="font-body text-ink-muted text-sm mb-6">表情包猜词完成</p>

          <div className="bg-cream rounded-doodle border-2 border-ink p-5 mb-3">
            <p className="font-body text-ink-muted text-sm mb-1">最终得分</p>
            <div className="font-display text-6xl text-coral leading-none">
              {score}
              <span className="text-3xl text-ink-muted"> / {SOLO_EMOJI_TOTAL * SOLO_EMOJI_SCORE_PER}</span>
            </div>
            <div className="mt-3 h-3 bg-cream-dark rounded-full overflow-hidden border border-ink/20">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  percent >= 80 ? "bg-mint" : percent >= 60 ? "bg-sun" : percent >= 40 ? "bg-coral" : "bg-ink-muted"
                }`}
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
          </div>

          <div className="bg-cream rounded-doodle border-2 border-ink p-3 mb-6 text-sm">
            <span className="text-ink-muted">答对：</span>
            <span className="font-display text-coral">{correctCount}</span>
            <span className="text-ink-muted"> / {SOLO_EMOJI_TOTAL} 题</span>
            <span className="mx-2 text-ink-muted">·</span>
            <span className="text-ink-muted">正确率：</span>
            <span className="font-display text-coral">{percent}%</span>
          </div>

          <button
            onClick={startEmoji}
            className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2 mb-3"
          >
            <RotateCcw size={22} />
            再来一局
          </button>
          <button
            onClick={() => {
              playSfx(sfx.click);
              navigate("/");
            }}
            className="btn-press w-full py-3 bg-white text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
          >
            <Home size={20} />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  /* ============ 加载中（题目未就绪） ============ */
  if (!currentQ) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-coral" />
      </div>
    );
  }

  const seconds = Math.ceil(timeLeft);
  const isUrgent = seconds <= 3 && seconds > 0 && !submitted;
  const isLast = qIndex + 1 >= SOLO_EMOJI_TOTAL;

  /* ============ 揭晓阶段 ============ */
  if (stage === "reveal" && revealInfo) {
    return (
      <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Smile size={16} className="text-coral" />
            <span className="font-display text-ink text-sm">表情包猜词 · 单人</span>
          </div>
          <div className="font-display text-ink text-sm bg-coral-light px-3 py-1 rounded-full border-2 border-ink">
            第 {qIndex + 1} / {SOLO_EMOJI_TOTAL} 题
          </div>
        </div>

        {/* emoji + 正确答案 */}
        <div className="flex-shrink-0 px-4 pt-3 pb-2 text-center">
          <div className="bg-white rounded-blob border-3 border-ink shadow-card px-5 py-3 inline-block mb-2">
            <p className="text-4xl leading-tight select-all">{currentQ.emoji}</p>
          </div>
          <div className="bg-mint/20 px-4 py-1.5 rounded-doodle border-2 border-mint inline-block animate-bounce-in">
            <span className="font-display text-ink flex items-center gap-1.5">
              <Check size={16} className="text-mint" />
              正确答案：
              <span className="text-mint">{currentQ.answer}</span>
            </span>
          </div>
        </div>

        {/* 我的回答 + 本题得分 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          <div className="max-w-md mx-auto space-y-3">
            <div
              className={`flex items-center gap-3 p-3 rounded-doodle border-2 animate-slide-up ${
                revealInfo.correct
                  ? "border-mint bg-mint/10"
                  : "border-coral bg-coral/10"
              }`}
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-coral text-white font-display text-sm border-2 border-ink flex-shrink-0">
                我
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink-muted">你的回答</div>
                <div
                  className={`font-display flex items-center gap-1.5 ${
                    revealInfo.correct ? "text-mint" : "text-coral"
                  }`}
                >
                  <span className="truncate">
                    {revealInfo.myGuess || "(空)"}
                  </span>
                  {revealInfo.correct && <Check size={16} />}
                </div>
              </div>
              <div
                className={`font-display text-xl flex-shrink-0 ${
                  revealInfo.correct ? "text-mint" : "text-coral"
                }`}
              >
                {revealInfo.correct ? `+${SOLO_EMOJI_SCORE_PER}` : "+0"}
              </div>
            </div>

            {/* 累计总分 */}
            <div className="bg-white rounded-doodle border-2 border-ink shadow-soft p-3 animate-slide-up" style={{ animationDelay: "0.15s" }}>
              <div className="flex items-center justify-center gap-2 mb-2">
                <Trophy size={16} className="text-sun" />
                <span className="font-display text-ink text-sm">累计得分</span>
              </div>
              <div className="text-center">
                <div className="font-display text-3xl text-coral">
                  {score}
                  <span className="text-base text-ink-muted"> / {SOLO_EMOJI_TOTAL * SOLO_EMOJI_SCORE_PER}</span>
                </div>
                <div className="text-xs text-ink-muted mt-1">
                  答对 {correctCount} / {SOLO_EMOJI_TOTAL} 题
                </div>
              </div>
            </div>

            {/* 别名提示 */}
            {currentQ.alternatives && currentQ.alternatives.length > 0 && (
              <div className="bg-cream rounded-doodle border-2 border-ink/20 p-2.5 text-xs text-ink-muted animate-slide-up" style={{ animationDelay: "0.3s" }}>
                <span className="font-display text-ink">可接受的别名：</span>
                {currentQ.alternatives.join("、")}
              </div>
            )}
          </div>
        </div>

        {/* 下一题按钮 */}
        <div className="flex-shrink-0 bg-white border-t-2 border-ink px-4 py-3">
          <button
            onClick={handleNext}
            disabled={!canNext}
            className={`btn-press w-full py-3 font-display text-lg rounded-doodle border-2 border-ink flex items-center justify-center gap-2 transition-all ${
              canNext
                ? "bg-ink text-cream shadow-soft"
                : "bg-cream-dark text-ink-muted cursor-not-allowed"
            }`}
          >
            {canNext ? (
              <>
                {isLast ? "查看最终结果" : "下一题"}
                <ArrowRight size={20} />
              </>
            ) : (
              <>
                <Loader2 size={18} className="animate-spin" />
                揭晓中...
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  /* ============ 答题阶段 ============ */
  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Smile size={16} className="text-coral" />
          <span className="font-display text-ink text-sm">表情包猜词 · 单人</span>
        </div>
        <div className="font-display text-ink text-sm bg-coral-light px-3 py-1 rounded-full border-2 border-ink">
          第 {qIndex + 1} / {SOLO_EMOJI_TOTAL} 题
        </div>
      </div>

      {/* 倒计时 */}
      <div className="flex-shrink-0 px-4 py-2">
        <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
          <span>{submitted ? "已提交" : "作答中"}</span>
          <span className={isUrgent ? "text-coral font-display" : ""}>
            {submitted ? "✓" : `${seconds}s`}
          </span>
        </div>
        <div className="h-2 bg-cream-dark rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-100 ${
              isUrgent ? "bg-coral" : "bg-mint"
            }`}
            style={{ width: `${(timeLeft / SOLO_EMOJI_TIME_LIMIT) * 100}%` }}
          />
        </div>
      </div>

      {/* emoji 展示 */}
      <div className="flex-shrink-0 px-4 py-3 text-center">
        <div className="inline-block bg-sun/30 px-3 py-1 rounded-full border-2 border-ink/30 font-body text-xs text-ink-muted mb-3">
          分类：{currentQ.category}
        </div>
        <div className="bg-white rounded-blob border-3 border-ink shadow-card px-5 py-6 inline-block">
          <p className="text-6xl leading-tight select-all">{currentQ.emoji}</p>
        </div>
      </div>

      {/* 输入框 */}
      <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0 flex flex-col justify-start">
        <div className="max-w-md mx-auto w-full">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={30}
              disabled={submitted}
              placeholder="输入你猜的词语"
              className={`flex-1 px-4 py-3 rounded-doodle border-2 border-ink bg-cream font-body text-ink focus:border-coral focus:bg-white transition-colors disabled:opacity-60 ${
                submitted ? "border-mint bg-mint/10" : ""
              }`}
            />
            <button
              onClick={handleSubmit}
              disabled={submitted || !guess.trim()}
              className={`btn-press px-4 py-3 font-display rounded-doodle border-2 border-ink flex items-center justify-center gap-1.5 transition-all ${
                submitted
                  ? "bg-mint text-ink cursor-default"
                  : !guess.trim()
                  ? "bg-cream-dark text-ink-muted cursor-not-allowed"
                  : "bg-coral text-white shadow-soft"
              }`}
            >
              {submitted ? (
                <>
                  <Check size={18} />
                </>
              ) : (
                <>
                  <Send size={18} />
                  提交
                </>
              )}
            </button>
          </div>
          <div className="mt-3 text-center text-xs text-ink-muted">
            输入你的猜测 · 超时自动提交空答案 · 不区分大小写与空格
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ 单人：达芬奇密码（vs AI） ============

type DVPhase = "idle" | "draw" | "guess" | "opponent-turn" | "gameover";
type DVTurn = "player" | "ai";

interface DVPlayerState {
  hand: DaVinciCard[];
}

function sortDaVinciHand(cards: DaVinciCard[]): DaVinciCard[] {
  // 先按数字升序，同数字黑在白左（黑X紧挨白X左边）
  return [...cards].sort((a, b) => {
    if (a.number !== b.number) return a.number - b.number;
    return a.color === "black" ? -1 : 1;
  });
}

function generateSoloDaVinciDeck(): DaVinciCard[] {
  const colors: DaVinciColor[] = ["black", "white"];
  const cards: DaVinciCard[] = [];
  let idxCounter = 0;
  for (const color of colors) {
    for (let n = 0; n <= 11; n++) {
      cards.push({ id: `solo_dv_${idxCounter++}`, color, number: n, revealed: false });
    }
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const DV_COLOR_STYLES: Record<DaVinciColor, { bg: string; text: string; border: string; label: string }> = {
  black: { bg: "bg-slate-900", text: "text-white", border: "border-slate-700", label: "黑" },
  white: { bg: "bg-white", text: "text-slate-900", border: "border-slate-300", label: "白" },
};
const DV_UNKNOWN_COLOR = "bg-gradient-to-br from-rose-200 to-rose-100";

function DVCardTile({
  card,
  isMine,
  isSelected,
  isDrawn,
  isNew,
  onClick,
  clickable,
  compact,
  wrongGuesses,
}: {
  card: DaVinciCard;
  isMine: boolean;
  isSelected?: boolean;
  isDrawn?: boolean;
  isNew?: boolean;
  onClick?: () => void;
  clickable?: boolean;
  compact?: boolean;
  wrongGuesses?: number[];
}) {
  const isUnknown = !isMine && !card.revealed;
  const style = isUnknown
    ? { bg: DV_UNKNOWN_COLOR, text: "text-rose-900/70", border: "border-rose-300" }
    : DV_COLOR_STYLES[card.color];
  const numberDisplay = card.revealed || isMine ? card.number : "?";
  const w = compact ? 48 : 58;
  const h = compact ? 68 : 82;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        disabled={!clickable}
        className={`
          relative rounded-xl border-[3px] shadow-card transition-all duration-200
          flex flex-col items-center justify-center select-none
          ${style.bg} ${style.text} ${style.border}
          ${clickable ? "hover:scale-105 hover:-translate-y-1 cursor-pointer" : "cursor-default"}
          ${isSelected ? "ring-4 ring-amber-400 scale-105 -translate-y-1" : ""}
          ${isDrawn ? "ring-2 ring-amber-300 animate-pulse" : ""}
          ${isNew ? "animate-[flipIn_0.5s_ease-out]" : ""}
        `}
        style={{ width: w, height: h }}
      >
        <span className="text-[10px] opacity-60 leading-none">{DV_COLOR_STYLES[card.color].label}</span>
        <span className={`${compact ? "text-xl" : "text-2xl"} font-black leading-none mt-1`}>{numberDisplay}</span>
        {card.revealed && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
            <X className="w-3 h-3 text-white" strokeWidth={3} />
          </span>
        )}
      </button>
      {wrongGuesses && wrongGuesses.length > 0 && (
        <div className="flex flex-wrap gap-0.5 justify-center max-w-[60px]">
          {wrongGuesses.map((n, i) => (
            <span key={i} className="text-[10px] font-bold text-coral bg-coral/10 rounded px-1 leading-tight line-through">
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SoloDaVinci() {
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [phase, setPhase] = useState<DVPhase>("idle");
  const [turn, setTurn] = useState<DVTurn>("player");
  const [player, setPlayer] = useState<DVPlayerState>({ hand: [] });
  const [ai, setAi] = useState<DVPlayerState>({ hand: [] });
  const [deck, setDeck] = useState<DaVinciCard[]>([]);
  const [drawnCard, setDrawnCard] = useState<DaVinciCard | null>(null);
  const [showDrawnPreview, setShowDrawnPreview] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);
  const [showGuessModal, setShowGuessModal] = useState(false);
  const [guessTargetIdx, setGuessTargetIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<{ correct: boolean; guesser: string; num: number } | null>(null);
  const [winner, setWinner] = useState<"player" | "ai" | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [passAvailable, setPassAvailable] = useState(false);
  // 错误猜测记录：cardId -> 猜过的数字列表
  const [wrongGuesses, setWrongGuesses] = useState<Record<string, number[]>>({});
  const timerRef = useRef<number | null>(null);

  const { sfxEnabled } = useAudioStore();
  const playSfx = useCallback((fn: () => void) => { if (sfxEnabled) fn(); }, [sfxEnabled]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const aiConfig = useMemo(() => {
    if (difficulty === "easy") return { delay: [1200, 2200] as [number, number], mistakeRate: 0.35, reasonChance: 0, continueChance: 0.3 };
    if (difficulty === "normal") return { delay: [700, 1500] as [number, number], mistakeRate: 0.18, reasonChance: 0.5, continueChance: 0.5 };
    return { delay: [400, 900] as [number, number], mistakeRate: 0.08, reasonChance: 0.9, continueChance: 0.7 };
  }, [difficulty]);

  const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  const startGame = useCallback(() => {
    clearTimer();
    const full = generateSoloDaVinciDeck();
    const pHand = sortDaVinciHand(full.splice(0, 4));
    const aHand = sortDaVinciHand(full.splice(0, 4));
    setPlayer({ hand: pHand });
    setAi({ hand: aHand });
    setDeck(full);
    setDrawnCard(null);
    setWinner(null);
    setPhase("draw");
    setTurn("player");
    setPassAvailable(false);
    setSelectedTarget(null);
    setShowGuessModal(false);
    setShowDrawnPreview(false);
    setToast(null);
    setAiThinking(false);
    setWrongGuesses({});
    playSfx(sfx.click);
  }, [clearTimer, playSfx]);

  const checkWinAfterReveal = useCallback((pHand: DaVinciCard[], aHand: DaVinciCard[]): "player" | "ai" | null => {
    if (aHand.every((c) => c.revealed)) return "player";
    if (pHand.every((c) => c.revealed)) return "ai";
    return null;
  }, []);

  const showToastMsg = useCallback((msg: { correct: boolean; guesser: string; num: number }) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1500);
  }, []);

  const playerDraw = useCallback(() => {
    if (turn !== "player" || phase !== "draw") return;
    if (deck.length === 0) {
      setPhase("guess");
      setPassAvailable(false);
      return;
    }
    const newDeck = [...deck];
    const card = newDeck.shift()!;
    setDeck(newDeck);
    setDrawnCard(card);
    setShowDrawnPreview(true);
    playSfx(sfx.click);
  }, [turn, phase, deck, playSfx]);

  const afterPreview = useCallback(() => {
    setShowDrawnPreview(false);
    setPhase("guess");
    setPassAvailable(false);
  }, []);

  const selectTarget = useCallback((idx: number) => {
    if (turn !== "player" || phase !== "guess") return;
    if (ai.hand[idx].revealed) return;
    setSelectedTarget(idx);
    setGuessTargetIdx(idx);
    setShowGuessModal(true);
  }, [turn, phase, ai.hand]);

  const submitGuess = useCallback((num: number) => {
    setShowGuessModal(false);
    if (guessTargetIdx === null) return;
    const targetCard = ai.hand[guessTargetIdx];
    const correct = targetCard.number === num;
    playSfx(correct ? sfx.correct : sfx.wrong);

    if (correct) {
      const newAiHand = ai.hand.map((c, i) =>
        i === guessTargetIdx ? { ...c, revealed: true } : c
      );
      setAi({ hand: newAiHand });
      showToastMsg({ correct: true, guesser: "你", num });
      setSelectedTarget(null);
      setGuessTargetIdx(null);

      let newPlayerHand = player.hand;
      if (drawnCard) {
        newPlayerHand = sortDaVinciHand([...player.hand, { ...drawnCard, revealed: false }]);
        setPlayer({ hand: newPlayerHand });
        setDrawnCard(null);
      }

      const w = checkWinAfterReveal(newPlayerHand, newAiHand);
      if (w) {
        setPhase("gameover");
        setWinner(w);
        return;
      }
      setPassAvailable(true);
      setPhase("guess");
    } else {
      showToastMsg({ correct: false, guesser: "你", num });
      // 记录错误猜测
      setWrongGuesses((prev) => {
        const cardId = targetCard.id;
        const existing = prev[cardId] || [];
        if (existing.includes(num)) return prev;
        return { ...prev, [cardId]: [...existing, num] };
      });
      let newPlayerHand = player.hand;
      if (drawnCard) {
        newPlayerHand = sortDaVinciHand([...player.hand, { ...drawnCard, revealed: true }]);
        setPlayer({ hand: newPlayerHand });
        setDrawnCard(null);
      } else {
        const hiddenIdx = newPlayerHand.findIndex((c) => !c.revealed);
        if (hiddenIdx >= 0) {
          newPlayerHand = newPlayerHand.map((c, i) =>
            i === hiddenIdx ? { ...c, revealed: true } : c
          );
          setPlayer({ hand: newPlayerHand });
        }
      }
      setSelectedTarget(null);
      setGuessTargetIdx(null);

      const w = checkWinAfterReveal(newPlayerHand, ai.hand);
      if (w) {
        setPhase("gameover");
        setWinner(w);
        return;
      }
      setTurn("ai");
      setPhase("opponent-turn");
      setPassAvailable(false);
      setAiThinking(true);
    }
  }, [guessTargetIdx, ai, player, drawnCard, playSfx, showToastMsg, checkWinAfterReveal]);

  const playerPass = useCallback(() => {
    if (turn !== "player" || !passAvailable) return;
    let newPlayerHand = player.hand;
    if (drawnCard) {
      newPlayerHand = sortDaVinciHand([...player.hand, { ...drawnCard, revealed: false }]);
      setPlayer({ hand: newPlayerHand });
      setDrawnCard(null);
    }
    setPassAvailable(false);
    setSelectedTarget(null);
    setTurn("ai");
    setPhase("opponent-turn");
    setAiThinking(true);
    playSfx(sfx.click);
  }, [turn, passAvailable, player, drawnCard, playSfx]);

  const aiPickGuess = useCallback((pHand: DaVinciCard[], aiHand: DaVinciCard[]): { targetIdx: number; number: number } => {
    const hidden = pHand.map((c, i) => ({ c, i })).filter(x => !x.c.revealed);
    if (hidden.length === 0) return { targetIdx: 0, number: 0 };

    const target = hidden[rand(0, hidden.length - 1)];
    const targetIdx = target.i;
    const targetCard = target.c;

    const usedNumbers = new Set<number>();
    [...pHand, ...aiHand].forEach(c => {
      if (c.color === targetCard.color) {
        if (c.revealed) usedNumbers.add(c.number);
      }
    });
    aiHand.forEach(c => {
      if (c.color === targetCard.color) usedNumbers.add(c.number);
    });

    const avail = Array.from({ length: 12 }, (_, i) => i).filter(n => !usedNumbers.has(n));

    const sameColor = pHand
      .map((c, i) => ({ c, i }))
      .filter(x => x.c.color === targetCard.color);
    const lowerBound = sameColor
      .filter(x => x.c.revealed && x.i < targetIdx)
      .reduce((m, x) => Math.max(m, x.c.number), -1);
    const upperBound = sameColor
      .filter(x => x.c.revealed && x.i > targetIdx)
      .reduce((m, x) => Math.min(m, x.c.number), 12);
    const candidates = avail.filter(n => n > lowerBound && n < upperBound);
    const pool = candidates.length > 0 ? candidates : avail;

    let number: number;
    if (Math.random() < aiConfig.mistakeRate) {
      const wrongPool = Array.from({ length: 12 }, (_, i) => i).filter(n => !pool.includes(n));
      number = wrongPool.length > 0 ? wrongPool[rand(0, wrongPool.length - 1)] : pool[rand(0, pool.length - 1)];
    } else {
      number = pool[rand(0, pool.length - 1)];
    }

    if (aiConfig.reasonChance > 0 && candidates.length === 1 && Math.random() < aiConfig.reasonChance) {
      number = candidates[0];
    }

    return { targetIdx, number };
  }, [aiConfig]);

  useEffect(() => {
    if (phase !== "opponent-turn" || turn !== "ai" || winner) return;

    let cancelled = false;

    const delay = (ms: number) => new Promise<void>((r) => {
      timerRef.current = window.setTimeout(() => { if (!cancelled) r(); }, ms);
    });

    const runAi = async () => {
      let curDeck = [...deck];
      let curDrawn: DaVinciCard | null = null;
      if (curDeck.length > 0) {
        await delay(rand(aiConfig.delay[0], aiConfig.delay[1]));
        if (cancelled) return;
        curDrawn = curDeck.shift()!;
        setDeck(curDeck);
        setDrawnCard(curDrawn);
        playSfx(sfx.click);
      } else {
        await delay(400);
        if (cancelled) return;
      }

      let curAiHand = ai.hand;
      let curPlayerHand = player.hand;
      let continueGuessing = true;
      let hasDrawnCard = !!curDrawn;

      while (continueGuessing && !cancelled) {
        await delay(rand(aiConfig.delay[0], aiConfig.delay[1]));
        if (cancelled) return;

        const guess = aiPickGuess(curPlayerHand, curAiHand);
        const targetCard = curPlayerHand[guess.targetIdx];
        const correct = targetCard.number === guess.number;
        playSfx(correct ? sfx.correct : sfx.wrong);

        if (correct) {
          curPlayerHand = curPlayerHand.map((c, i) =>
            i === guess.targetIdx ? { ...c, revealed: true } : c
          );
          setPlayer({ hand: curPlayerHand });
          showToastMsg({ correct: true, guesser: "AI", num: guess.number });

          if (hasDrawnCard && curDrawn) {
            curAiHand = sortDaVinciHand([...curAiHand, { ...curDrawn, revealed: false }]);
            setAi({ hand: curAiHand });
            curDrawn = null;
            hasDrawnCard = false;
          }

          const w = checkWinAfterReveal(curPlayerHand, curAiHand);
          if (w) {
            setWinner(w);
            setPhase("gameover");
            setDrawnCard(null);
            setAiThinking(false);
            return;
          }
          const hiddenLeft = curPlayerHand.filter(c => !c.revealed).length;
          if (hiddenLeft === 0) { continueGuessing = false; break; }
          if (Math.random() > aiConfig.continueChance) continueGuessing = false;
        } else {
          showToastMsg({ correct: false, guesser: "AI", num: guess.number });
          // 记录错误猜测
          setWrongGuesses((prev) => {
            const cardId = targetCard.id;
            const existing = prev[cardId] || [];
            if (existing.includes(guess.number)) return prev;
            return { ...prev, [cardId]: [...existing, guess.number] };
          });
          if (hasDrawnCard && curDrawn) {
            curAiHand = sortDaVinciHand([...curAiHand, { ...curDrawn, revealed: true }]);
            setAi({ hand: curAiHand });
            curDrawn = null;
            hasDrawnCard = false;
          } else {
            const hiddenIdx = curAiHand.findIndex((c) => !c.revealed);
            if (hiddenIdx >= 0) {
              curAiHand = curAiHand.map((c, i) => i === hiddenIdx ? { ...c, revealed: true } : c);
              setAi({ hand: curAiHand });
            }
          }
          const w = checkWinAfterReveal(curPlayerHand, curAiHand);
          if (w) {
            setWinner(w);
            setPhase("gameover");
            setDrawnCard(null);
            setAiThinking(false);
            return;
          }
          continueGuessing = false;
        }
      }

      if (hasDrawnCard && curDrawn) {
        curAiHand = sortDaVinciHand([...curAiHand, { ...curDrawn, revealed: false }]);
        setAi({ hand: curAiHand });
        curDrawn = null;
        hasDrawnCard = false;
      }

      if (cancelled) return;
      setDrawnCard(null);
      setAiThinking(false);
      setTurn("player");
      setPhase("draw");
    };

    runAi();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, turn]);

  if (phase === "idle") {
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative">
        <div className="w-full max-w-md flex flex-col items-center relative z-10">
          <div className="mt-4 mb-2 text-center animate-bounce-in">
            <h1 className="font-display text-4xl text-ink leading-tight">🔐 达芬奇密码 · vs AI</h1>
            <p className="font-body text-ink-muted text-sm mt-2">
              破译对手所有手牌，成为密码大师！
            </p>
          </div>

          <div className="w-full bg-white rounded-blob shadow-card border-3 border-ink p-5 mt-4 animate-slide-up">
            <p className="text-sm text-ink/70 leading-relaxed mb-4">
              每人 4 张手牌（黑/白 0-11），按颜色+数字从小到大排列。<br/>
              回合：摸牌 → 猜对手任一张牌的数字 → 猜对可继续猜或结束回合 → 猜错则自己刚摸的牌倒下亮出。<br/>
              破译对手所有牌即获胜！
            </p>

            <div className="mb-4">
              <p className="font-display text-ink text-sm mb-2">难度选择</p>
              <div className="grid grid-cols-2 gap-2">
                {DIFFICULTY_LIST.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => setDifficulty(d.key)}
                    className={`py-2.5 rounded-doodle border-2 font-display text-sm transition-all flex items-center justify-center gap-1.5 ${
                      difficulty === d.key
                        ? "bg-coral text-white border-ink shadow-soft"
                        : "bg-white text-ink border-ink/30"
                    }`}
                  >
                    <span>{d.icon}</span>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={startGame}
              className="w-full btn-press bg-coral text-white font-display text-lg rounded-doodle border-3 border-ink py-3 shadow-pop flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition-all"
            >
              <Sparkles size={20} /> 开始游戏
            </button>
            <button
              onClick={() => { playSfx(sfx.click); navigate("/"); }}
              className="btn-press w-full py-2 mt-3 text-ink-muted font-body text-sm"
            >
              ← 返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "gameover" && winner) {
    const iWin = winner === "player";
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-md text-center">
          <div className={`text-6xl font-display mb-3 ${iWin ? "text-mint" : "text-coral"}`}>
            {iWin ? "🎉 你赢了！" : "😈 AI 获胜"}
          </div>
          {iWin && <Confetti />}
          <div className="bg-white rounded-blob border-3 border-ink shadow-card p-4 mb-4">
            <h4 className="font-display mb-3">最终手牌</h4>
            <div className="mb-3">
              <div className="text-xs text-ink/60 mb-1.5">你（{player.hand.filter(c=>c.revealed).length} 张倒下）</div>
              <div className="flex gap-1.5 justify-center flex-wrap">
                {player.hand.map((c) => <DVCardTile key={c.id} card={c} isMine compact />)}
              </div>
            </div>
            <div>
              <div className="text-xs text-ink/60 mb-1.5">AI（{ai.hand.filter(c=>c.revealed).length} 张倒下）</div>
              <div className="flex gap-1.5 justify-center flex-wrap">
                {ai.hand.map((c) => <DVCardTile key={c.id} card={c} isMine compact />)}
              </div>
            </div>
          </div>
          <button
            onClick={startGame}
            className="w-full btn-press bg-coral text-white font-display rounded-doodle border-3 border-ink py-3 shadow-pop flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition-all mb-2"
          >
            <RotateCcw size={18} /> 再来一局
          </button>
          <button
            onClick={() => { playSfx(sfx.click); navigate("/"); }}
            className="w-full btn-press bg-white text-ink font-display rounded-doodle border-3 border-ink py-3 flex items-center justify-center gap-2 hover:bg-cream active:scale-95 transition-all"
          >
            <Home size={18} /> 返回首页
          </button>
        </div>
      </div>
    );
  }

  const playerHidden = player.hand.filter(c => !c.revealed).length;
  const aiHidden = ai.hand.filter(c => !c.revealed).length;
  const isPlayerTurn = turn === "player";
  const statusText = isPlayerTurn
    ? (phase === "draw" ? "你的回合 · 点击摸牌" : passAvailable ? "猜对了！继续猜或结束回合" : "你的回合 · 点 AI 的一张牌来猜")
    : "AI 思考中...";

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <span className="font-display text-ink text-sm">🔐 达芬奇密码 · vs AI</span>
        <button
          onClick={() => { playSfx(sfx.click); navigate("/"); }}
          className="btn-press text-ink-muted text-xs font-body flex items-center gap-1 hover:text-ink"
        >
          <Home size={14} /> 退出
        </button>
      </div>

      <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between text-xs text-ink/70">
        <span>牌库：{deck.length}</span>
        <span className={`font-display ${isPlayerTurn ? "text-mint" : "text-coral"}`}>{statusText}</span>
        <span>难度：{getDifficultyConfig(difficulty).label}</span>
      </div>

      <div className="flex-shrink-0 px-4 py-3 bg-cream/40">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-9 h-9 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 border-2 border-ink flex items-center justify-center text-white font-bold ${!isPlayerTurn ? "ring-2 ring-coral animate-pulse" : ""}`}>
            AI
          </div>
          <div className="text-sm">
            <div className="font-display">AI</div>
            <div className="text-[11px] text-ink/60">剩余 {aiHidden} / {ai.hand.length} 张未破译</div>
          </div>
          {aiThinking && <Loader2 size={16} className="animate-spin text-ink/50 ml-auto" />}
        </div>
        <div className="flex gap-1.5 justify-center flex-wrap">
          {ai.hand.map((c, i) => (
            <DVCardTile
              key={c.id}
              card={c}
              isMine={false}
              isSelected={selectedTarget === i}
              isNew={c.revealed}
              clickable={isPlayerTurn && phase === "guess" && !c.revealed}
              wrongGuesses={wrongGuesses[c.id]}
              onClick={() => selectTarget(i)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-3 overflow-y-auto min-h-0">
        {isPlayerTurn && drawnCard && phase === "guess" && (
          <div className="mb-3 flex flex-col items-center">
            <div className="text-xs text-ink/60 mb-1">你摸到的新牌</div>
            <div className="flex items-center gap-3">
              <div className={`${DV_COLOR_STYLES[drawnCard.color].bg} ${DV_COLOR_STYLES[drawnCard.color].text} ${DV_COLOR_STYLES[drawnCard.color].border} border-[3px] rounded-xl shadow-card flex flex-col items-center justify-center`} style={{ width: 64, height: 90 }}>
                <span className="text-[11px] opacity-70">{DV_COLOR_STYLES[drawnCard.color].label}</span>
                <span className="text-2xl font-black mt-1">{drawnCard.number}</span>
              </div>
              <Eye className="text-ink/40" size={20} />
              <span className="text-xs text-ink/50 max-w-[100px]">只有你能看到。猜对暗置入手牌，猜错则倒下亮出。</span>
            </div>
          </div>
        )}

        {isPlayerTurn && phase === "draw" && (
          <button
            onClick={playerDraw}
            className="btn-press bg-gradient-to-br from-mint to-teal-400 text-white font-display text-xl rounded-3xl border-3 border-ink px-8 py-5 shadow-pop flex items-center gap-3 hover:brightness-110 active:scale-95 transition-all"
          >
            <Sparkles size={24} /> 摸一张牌
          </button>
        )}

        {isPlayerTurn && phase === "guess" && passAvailable && (
          <div className="flex gap-3 mt-3">
            <button
              onClick={playerPass}
              className="btn-press bg-white text-ink font-display rounded-full border-3 border-ink px-6 py-2.5 shadow-pop flex items-center gap-2 hover:bg-cream active:scale-95 transition-all"
            >
              <ArrowRight size={18} /> 结束回合
            </button>
          </div>
        )}

        {isPlayerTurn && phase === "guess" && !passAvailable && !drawnCard && deck.length === 0 && (
          <div className="text-sm text-ink/60 text-center">牌库已空，请继续猜牌</div>
        )}
      </div>

      <div className="flex-shrink-0 px-4 py-3 bg-white border-t-3 border-ink">
        <div className="flex gap-1.5 justify-center flex-wrap mb-2">
          {player.hand.map((c) => (
            <DVCardTile key={c.id} card={c} isMine wrongGuesses={wrongGuesses[c.id]} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-full bg-gradient-to-br from-coral to-rose-400 border-2 border-ink flex items-center justify-center text-white font-bold ${isPlayerTurn ? "ring-2 ring-mint animate-pulse" : ""}`}>
            <User size={18} />
          </div>
          <div className="text-sm">
            <div className="font-display">你</div>
            <div className="text-[11px] text-ink/60">剩余 {playerHidden} / {player.hand.length} 张未破译</div>
          </div>
          <button
            onClick={startGame}
            className="ml-auto w-8 h-8 rounded-full border-2 border-ink/30 flex items-center justify-center text-ink/60 hover:bg-cream"
            title="重新开始"
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      {showDrawnPreview && drawnCard && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-[fadeIn_0.2s]">
          <div className="bg-white rounded-3xl p-7 shadow-pop flex flex-col items-center gap-4 animate-[popIn_0.3s_ease-out]">
            <h3 className="text-xl font-bold text-ink">你摸到了一张新牌</h3>
            <p className="text-sm text-ink/60">将其保密，准备猜 AI 的牌</p>
            <div className={`${DV_COLOR_STYLES[drawnCard.color].bg} ${DV_COLOR_STYLES[drawnCard.color].text} ${DV_COLOR_STYLES[drawnCard.color].border} border-[3px] rounded-2xl shadow-card flex flex-col items-center justify-center`} style={{ width: 84, height: 120 }}>
              <span className="text-sm opacity-70">{DV_COLOR_STYLES[drawnCard.color].label}</span>
              <span className="text-4xl font-black">{drawnCard.number}</span>
            </div>
            <button
              onClick={afterPreview}
              className="flex items-center gap-2 bg-mint text-white font-bold rounded-full px-6 py-2.5 shadow-pop hover:brightness-110 active:scale-95 transition-all"
            >
              知道了 <Check className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showGuessModal && guessTargetIdx !== null && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-[fadeIn_0.2s] p-4">
          <div className="bg-cream rounded-3xl p-6 shadow-pop max-w-sm w-full">
            <h3 className="text-xl font-bold text-ink text-center mb-1">猜一个数字</h3>
            <p className="text-sm text-ink/60 text-center mb-4">
              这是一张 {DV_COLOR_STYLES[ai.hand[guessTargetIdx].color].label} 牌，猜 0-11 之间的数字
            </p>
            <div className="grid grid-cols-6 gap-2 mb-4">
              {Array.from({ length: 12 }, (_, i) => i).map((n) => {
                const cardColor = ai.hand[guessTargetIdx]?.color;
                const btnStyle = cardColor === "black"
                  ? "bg-slate-900 text-white border-slate-700"
                  : cardColor === "white"
                    ? "bg-white text-slate-900 border-slate-300"
                    : "bg-white text-ink border-ink/20";
                return (
                  <button
                    key={n}
                    onClick={() => submitGuess(n)}
                    className={`h-11 rounded-lg border-2 font-bold text-lg transition-all ${btnStyle} hover:scale-105 active:scale-95`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => { setShowGuessModal(false); setSelectedTarget(null); setGuessTargetIdx(null); }}
              className="w-full py-2.5 rounded-full border-2 border-ink/20 text-ink/70 font-bold hover:bg-ink/5 active:scale-95 transition-all"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 rounded-2xl px-6 py-4 shadow-pop text-center animate-[popIn_0.3s_ease-out] ${toast.correct ? "bg-mint" : "bg-coral"} text-white`}>
          <div className="text-2xl font-black mb-1">{toast.correct ? "破译成功！" : "破译失败！"}</div>
          <div className="text-sm opacity-90">
            {toast.guesser} 猜 <b className="text-lg">{toast.num}</b>
          </div>
        </div>
      )}
    </div>
  );
}
