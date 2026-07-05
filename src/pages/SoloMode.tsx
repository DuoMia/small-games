import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  type Difficulty,
} from "@/lib/difficulty";
import wordBank from "../../api/data/words.json";

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

/** 把笔画渲染成 DataURL */
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

export default function SoloMode() {
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

  // 难度选择
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const diffConfig = getDifficultyConfig(difficulty);

  // 画图阶段状态
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const [wordEntries, setWordEntries] = useState<WordEntry[]>([]);
  const [drawings, setDrawings] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drawMode, setDrawMode] = useState<DrawMode>("view");
  const [timeLeft, setTimeLeft] = useState(diffConfig.viewTime);
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

  const totalPages = diffConfig.totalWords;
  const quizCount = diffConfig.quizCount;
  const viewTime = diffConfig.viewTime;
  const drawTime = diffConfig.drawTime;

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

  // 画图全部完成 → 生成 DataURL + 题目，进入答题
  useEffect(() => {
    if (stage !== "draw" || drawMode !== "done") return;
    const finalPages = pagesRef.current;
    const dataURLs = finalPages.map((s) => strokesToDataURL(s));
    setDrawings(dataURLs);
    setQuestions(genQuestions(wordEntries, quizCount));
    setQuizIndex(0);
    setAnswer("");
    setQuizResult(null);
    setStage("quiz");
    playSfx(sfx.roundEnd);
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
            <h1 className="font-display text-5xl text-ink leading-tight">单人测试</h1>
            <div className="mt-1 flex items-center justify-center gap-2">
              <div className="h-1 w-16 bg-mint rounded-full" />
              <User size={20} className="text-mint" />
              <div className="h-1 w-16 bg-mint rounded-full" />
            </div>
            <p className="font-body text-ink-muted text-sm mt-3">
              不需要联网 · 独立测试游玩
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
            </div>

            {/* 题量选择 */}
            <div className="mb-5">
              <p className="font-display text-ink text-sm mb-2">题量选择</p>
              <div className="flex gap-2">
                {[15, 30].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setDifficulty(
                        n === 15 && difficulty === "normal"
                          ? "easy"
                          : difficulty
                      );
                      // 简单切换题量：15 词用 easy 配置，30 词用 normal
                      if (n === 15) setDifficulty("easy");
                      else setDifficulty("normal");
                      playSfx(sfx.uiTick);
                    }}
                    className={`flex-1 py-3 rounded-doodle border-2 font-display text-base transition-all ${
                      totalPages === n
                        ? "bg-coral text-white border-ink shadow-soft"
                        : "bg-white text-ink border-ink/30"
                    }`}
                  >
                    {n} 词
                  </button>
                ))}
              </div>
              <p className="text-center text-xs text-ink-muted mt-2">
                共 {totalPages} 个词 · 答题 {quizCount} 题 · 每题 1 分
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
            <span className="font-display text-ink text-sm">单人测试</span>
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
          <span className="font-display text-ink text-sm">单人测试 · 答题</span>
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
