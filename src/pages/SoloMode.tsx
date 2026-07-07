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
  HelpCircle,
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
import turtleSoups from "../../api/data/turtle-soup.json";
import drawingPrompts from "../../api/data/drawing-prompts.json";
import emojiPuzzles from "../../api/data/emoji-puzzles.json";
import type { GameType } from "@/lib/types";
import { useSpeech } from "@/hooks/useSpeech";
import { Mic, Square } from "lucide-react";

// ============ 单人模式分发器 ============
// 根据路由 /solo/:gameType 渲染不同的单人游戏组件
const SOLO_GAME_NAMES: Record<GameType, string> = {
  "draw-memory": "画词记忆",
  "telepathy": "默契考验",
  "turtle-soup": "海龟汤",
  "co-op-drawing": "合作画画",
  "emoji-guessing": "表情包猜词",
};

const SOLO_GAME_EMOJI: Record<GameType, string> = {
  "draw-memory": "🎨",
  "telepathy": "💕",
  "turtle-soup": "🐢",
  "co-op-drawing": "✏️",
  "emoji-guessing": "😎",
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
    case "turtle-soup":
      return <SoloTurtleSoup />;
    case "co-op-drawing":
      return <SoloCoOpDrawing />;
    case "emoji-guessing":
      return <SoloEmoji />;
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

// ============ 单人海龟汤 ============
interface TurtleSoupEntry {
  id: string;
  title: string;
  difficulty: string;
  category: string;
  surface: string;
  truth: string;
  keywords: string[];
}
interface SoloTurtleRecord {
  question: string;
  answer: "是" | "否" | "无关";
}
const SOLO_TURTLE_MAX_QUESTIONS = 10;
const SOLO_TURTLE_DIFFICULTY_LABEL: Record<string, string> = {
  any: "任意",
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

function pickTurtleSoup(): TurtleSoupEntry {
  const arr = turtleSoups as TurtleSoupEntry[];
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 获取后端URL（与 socket.ts 同逻辑） */
function getBackendUrl(): string {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  if (envBase && envBase.trim()) {
    return envBase.replace(/\/+$/, "");
  }
  return "";
}

// 后端可用性缓存：null=未探测，true=可用，false=不可用
let backendAvailableCache: boolean | null = null;

/** 探测后端是否可用（调健康检查接口，2秒超时） */
async function probeBackend(): Promise<boolean> {
  if (backendAvailableCache !== null) return backendAvailableCache;
  try {
    const base = getBackendUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${base}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    backendAvailableCache = resp.ok;
  } catch {
    backendAvailableCache = false;
  }
  console.log("[SoloTurtleSoup] 后端可用性探测结果:", backendAvailableCache);
  return backendAvailableCache;
}

/** 单人海龟汤本地判断逻辑：含关键词→"是"，否则随机（AI不可用时的兜底） */
function localJudge(question: string, keywords: string[]): "是" | "否" | "无关" {
  const q = question.toLowerCase();
  const hit = keywords.some((k) => k && q.includes(k.toLowerCase()));
  if (hit) return "是";
  // 随机：偏向"否"和"无关"，避免太容易猜
  const r = Math.random();
  if (r < 0.45) return "否";
  if (r < 0.85) return "无关";
  return "是";
}

/** 调后端 AI 判断，后端不可用直接走本地判断 */
async function aiJudgeQuestion(
  question: string,
  truth: string,
  keywords: string[]
): Promise<"是" | "否" | "无关"> {
  // 后端不可用，直接本地判断
  const available = await probeBackend();
  if (!available) {
    return localJudge(question, keywords);
  }
  try {
    const base = getBackendUrl();
    const resp = await fetch(`${base}/api/turtle-judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, truth, keywords }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.success && data.answer) return data.answer;
    throw new Error("invalid response");
  } catch (err) {
    console.warn("[SoloTurtleSoup] AI判断失败，回退本地判断:", err);
    // 单次失败不污染缓存，下次仍可重试
    return localJudge(question, keywords);
  }
}

function SoloTurtleSoup() {
  const navigate = useNavigate();
  const { sfxEnabled } = useAudioStore();
  const { listening, transcript, start, stop, supported: speechSupported, error: speechError } = useSpeech();

  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  const [stage, setStage] = useState<"intro" | "playing" | "result">("intro");
  const [soup, setSoup] = useState<TurtleSoupEntry | null>(null);
  const [records, setRecords] = useState<SoloTurtleRecord[]>([]);
  const [questionsLeft, setQuestionsLeft] = useState(SOLO_TURTLE_MAX_QUESTIONS);
  const [inputText, setInputText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [won, setWon] = useState(false);
  const [judging, setJudging] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);

  const startTurtle = () => {
    setSoup(pickTurtleSoup());
    setRecords([]);
    setQuestionsLeft(SOLO_TURTLE_MAX_QUESTIONS);
    setInputText("");
    setRevealed(false);
    setWon(false);
    setJudging(false);
    setStage("playing");
    playSfx(sfx.click);
  };

  // 组件挂载时提前探测后端可用性（不阻塞UI）
  useEffect(() => {
    probeBackend();
  }, []);

  // 语音识别结果自动填入输入框
  useEffect(() => {
    if (transcript) {
      setInputText(transcript);
    }
  }, [transcript]);

  // 新提问到达时滚动到底部
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [records.length, revealed, judging]);

  const handleAsk = async () => {
    const q = inputText.trim();
    if (!q || revealed || questionsLeft <= 0 || !soup || judging) return;
    setJudging(true);
    setInputText("");
    const answer = await aiJudgeQuestion(q, soup.truth, soup.keywords);
    setJudging(false);
    setRecords((r) => [...r, { question: q, answer }]);
    setQuestionsLeft((n) => n - 1);
    playSfx(answer === "是" ? sfx.correct : answer === "否" ? sfx.wrong : sfx.uiTick);
    // 用完 10 次提问自动揭晓
    if (questionsLeft - 1 <= 0) {
      setTimeout(() => {
        setRevealed(true);
        setWon(false);
        setStage("result");
        playSfx(sfx.lose);
      }, 600);
    }
  };

  const handleReveal = () => {
    if (revealed || !soup) return;
    setRevealed(true);
    setWon(false);
    setStage("result");
    playSfx(sfx.lose);
  };

  /* ============ 介绍页 ============ */
  if (stage === "intro") {
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative">
        <div className="absolute top-10 left-5 text-6xl animate-float opacity-20">🐢</div>
        <div className="absolute top-20 right-5 text-5xl animate-float opacity-20" style={{ animationDelay: "1s" }}>🍲</div>
        <div className="absolute bottom-20 left-8 text-5xl animate-float opacity-20" style={{ animationDelay: "2s" }}>🔍</div>

        <div className="w-full max-w-md flex flex-col items-center relative z-10">
          <div className="mt-8 mb-2 text-center animate-bounce-in">
            <h1 className="font-display text-5xl text-ink leading-tight">海龟汤 · 单人游玩</h1>
            <div className="mt-1 flex items-center justify-center gap-2">
              <div className="h-1 w-16 bg-mint rounded-full" />
              <HelpCircle size={20} className="text-mint" />
              <div className="h-1 w-16 bg-mint rounded-full" />
            </div>
            <p className="font-body text-ink-muted text-sm mt-3">
              单人游玩：海龟汤 · AI主持人判断 · 支持语音提问
            </p>
          </div>

          <div className="w-full bg-white rounded-blob shadow-card border-3 border-ink p-6 mt-6 animate-slide-up">
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-3 bg-mint rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-coral border-2 border-ink font-display text-white">1</div>
                <div className="flex-1">
                  <div className="font-display text-ink">读汤面</div>
                  <div className="text-xs text-ink-muted">系统随机抽一题，看表面故事</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-sun rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-ink border-2 border-ink font-display text-cream">2</div>
                <div className="flex-1">
                  <div className="font-display text-ink">文字/语音提问</div>
                  <div className="text-xs text-ink-muted">AI主持人回答"是/否/无关"，共 10 问</div>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-coral-light rounded-doodle p-3 border-2 border-ink shadow-soft">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-mint border-2 border-ink font-display text-ink">3</div>
                <div className="flex-1">
                  <div className="font-display text-ink">揭晓汤底</div>
                  <div className="text-xs text-ink-muted">随时可看真相，或问完自动揭晓</div>
                </div>
              </div>
            </div>

            <button
              onClick={startTurtle}
              className="btn-press w-full py-4 bg-mint text-ink font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2"
            >
              <HelpCircle size={22} />
              开始挑战
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
  if (stage === "result" && soup) {
    return (
      <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-md bg-white rounded-blob shadow-card border-3 border-ink p-6 text-center animate-bounce-in">
          <div className="text-6xl mb-3 animate-float">{won ? "🎉" : "😇"}</div>
          <h2 className={`font-display text-3xl mb-1 ${won ? "text-mint" : "text-coral"}`}>
            {won ? "猜中了！" : "挑战结束"}
          </h2>
          <p className="font-body text-ink-muted text-sm mb-4">
            {won ? "你还原了真相" : "真相揭晓"}
          </p>

          <div className="bg-cream rounded-doodle border-2 border-ink p-4 mb-4 text-left">
            <div className="flex items-center gap-1.5 mb-2">
              <Trophy size={14} className="text-sun" />
              <span className="font-display text-ink text-xs">汤底真相</span>
            </div>
            <p className="font-body text-ink text-sm leading-relaxed">{soup.truth}</p>
          </div>

          <div className="bg-cream rounded-doodle border-2 border-ink p-2 mb-6 text-xs text-ink-muted">
            提问 {records.length} / {SOLO_TURTLE_MAX_QUESTIONS} 次
          </div>

          <button
            onClick={startTurtle}
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

  /* ============ 游戏中 ============ */
  if (!soup) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <p className="text-ink-muted">准备汤面中...</p>
      </div>
    );
  }

  const canInteract = !revealed && questionsLeft > 0 && !judging;

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-base">🐢</span>
          <span className="font-display text-ink text-sm">海龟汤 · 单人</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-display text-ink text-xs bg-sun px-2 py-1 rounded-full border-2 border-ink">
            {SOLO_TURTLE_DIFFICULTY_LABEL[soup.difficulty] || soup.difficulty}
          </span>
          <span
            className={`font-display text-xs px-2 py-1 rounded-full border-2 border-ink ${
              questionsLeft <= 3 ? "bg-coral text-white" : "bg-mint text-ink"
            }`}
          >
            剩余 {questionsLeft} 问
          </span>
        </div>
      </div>

      {/* 汤面 + 历史 */}
      <div ref={historyRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {/* 汤面 */}
        <div className="bg-white rounded-blob border-3 border-ink shadow-card p-4 mb-3 animate-bounce-in">
          <div className="flex items-center gap-1.5 mb-2">
            <HelpCircle size={14} className="text-coral" />
            <span className="font-display text-ink text-xs">汤面：{soup.title}</span>
            {soup.category && (
              <span className="ml-auto text-[10px] text-ink-muted bg-cream-dark px-2 py-0.5 rounded-full">
                {soup.category}
              </span>
            )}
          </div>
          <p className="font-body text-ink text-sm leading-relaxed">{soup.surface}</p>
        </div>

        {/* AI 判断中提示 */}
        {judging && (
          <div className="bg-coral-light rounded-doodle border-2 border-ink p-3 mb-3 flex items-center gap-2 animate-slide-up">
            <Loader2 size={16} className="animate-spin text-coral flex-shrink-0" />
            <span className="font-body text-ink text-sm">AI主持人正在思考...</span>
          </div>
        )}

        {/* 提问历史 */}
        {records.length > 0 && (
          <div className="space-y-2 mb-3">
            {records.map((r, idx) => {
              const style =
                r.answer === "是"
                  ? "bg-mint text-ink border-ink"
                  : r.answer === "否"
                  ? "bg-coral text-white border-ink"
                  : "bg-cream-dark text-ink-muted border-ink-muted";
              return (
                <div key={idx} className="bg-white rounded-doodle border-2 border-ink/30 p-2.5 animate-slide-up">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-ink-muted mb-0.5">问：</div>
                      <div className="font-body text-ink text-sm break-words">{r.question}</div>
                    </div>
                    <span className={`flex-shrink-0 px-2.5 py-1 rounded-full border-2 font-display text-xs ${style}`}>
                      {r.answer}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 提示 */}
        {records.length === 0 && !judging && (
          <div className="text-center text-xs text-ink-muted py-3">
            AI主持人根据汤底判断你的提问 · 支持语音
          </div>
        )}
      </div>

      {/* 语音识别错误提示 */}
      {speechError && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-coral/10 border-t border-coral/30">
          <p className="text-xs text-coral text-center">{speechError}</p>
        </div>
      )}

      {/* 底部输入区 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
            maxLength={100}
            disabled={!canInteract}
            placeholder={judging ? "AI思考中..." : canInteract ? "提问... (回车发送)" : "已揭晓"}
            className="flex-1 px-3 py-2.5 rounded-doodle border-2 border-ink bg-cream font-body text-ink text-sm focus:border-coral focus:bg-white transition-colors disabled:opacity-50"
          />
          {/* 语音按钮 */}
          {speechSupported && (
            <button
              onClick={listening ? stop : start}
              disabled={!canInteract}
              className={`btn-press flex-shrink-0 w-11 h-11 rounded-doodle border-2 border-ink flex items-center justify-center disabled:opacity-40 ${
                listening ? "bg-coral text-white animate-pulse" : "bg-sun text-ink"
              }`}
              title={listening ? "停止录音" : "语音输入"}
            >
              {listening ? <Square size={16} /> : <Mic size={18} />}
            </button>
          )}
          <button
            onClick={handleAsk}
            disabled={!canInteract || !inputText.trim()}
            className="btn-press flex-shrink-0 w-11 h-11 rounded-doodle border-2 border-ink bg-coral text-white flex items-center justify-center disabled:opacity-40"
            title="发送提问"
          >
            {judging ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
        <button
          onClick={handleReveal}
          disabled={revealed || judging}
          className="btn-press w-full mt-2 py-2.5 bg-ink text-cream font-display text-sm rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          <Sparkles size={16} />
          查看汤底
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
