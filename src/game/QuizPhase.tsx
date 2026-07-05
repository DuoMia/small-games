import { useState, useEffect } from "react";
import { Send, Check, X, Loader2, ArrowRight } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";

export default function QuizPhase({ roomId }: { roomId: string }) {
  const {
    currentQuestion,
    quizResult,
    quizReveal,
    opponentAnswered,
    drawings,
    currentRound,
    room,
    myId,
  } = useGameStore();
  const { submitAnswer, nextQuestion } = useRoomActions();
  const { sfxEnabled } = useAudioStore();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const [answer, setAnswer] = useState("");
  const [inputShake, setInputShake] = useState(false);

  const q = currentQuestion;
  const wordIndex = q?.wordIndex ?? 0;
  const myDrawing = drawings[wordIndex] || "";
  const opponent = room?.players.find((p) => p.id !== myId);

  // 切题时重置输入
  useEffect(() => {
    setAnswer("");
  }, [q?.questionIndex]);

  if (!q) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin text-coral mx-auto mb-3" />
          <p className="text-ink-muted">准备答题...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    if (!answer.trim() || quizResult) return;
    submitAnswer(roomId, q.questionIndex, answer.trim());
    playSfx(sfx.click);
  };

  const handleNext = () => {
    nextQuestion(roomId);
    playSfx(sfx.click);
  };

  const isAnswered = !!quizResult;
  const isRevealed = !!quizReveal;
  const waitingForOpponent = isAnswered && !isRevealed;

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-display text-ink text-sm">第 {currentRound} 轮</span>
          <span className="text-ink-muted text-xs">· 答题阶段</span>
        </div>
        <div className="font-display text-ink text-sm bg-sun px-3 py-1 rounded-full border-2 border-ink">
          第 {q.questionIndex + 1} / {q.totalQuestions} 题
        </div>
      </div>

      {/* 题目 */}
      <div className="flex-shrink-0 px-4 pt-2 pb-1 text-center">
        <p className="font-body text-ink-muted text-sm">看画回忆，这个词语是什么？</p>
        <h2 className="font-display text-2xl text-ink mt-1">
          第 <span className="text-coral">{wordIndex + 1}</span> 个词
        </h2>
      </div>

      {/* 画作参考 */}
      <div className="flex-1 flex items-center justify-center px-4 py-3 min-h-0">
        <div className="relative w-full max-w-xs aspect-[4/3] bg-white rounded-doodle border-3 border-ink shadow-card overflow-hidden">
          {myDrawing ? (
            <img
              src={myDrawing}
              alt={`第${wordIndex + 1}张画`}
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
            #{wordIndex + 1}
          </div>
          {/* 答题结果遮罩 */}
          {isAnswered && (
            <div
              className={`absolute inset-0 flex items-center justify-center ${
                quizResult?.correct ? "bg-mint/40" : "bg-coral/40"
              }`}
            >
              <div
                className={`transform scale-150 ${
                  quizResult?.correct
                    ? "text-mint animate-bounce-in"
                    : "text-coral animate-shake"
                }`}
              >
                {quizResult?.correct ? <Check size={48} /> : <X size={48} />}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 答案展示 */}
      {isAnswered && quizResult && (
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
        {!isAnswered ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="输入你猜的词语..."
              maxLength={20}
              autoFocus
              className={`flex-1 min-w-0 px-4 py-3 rounded-doodle border-2 border-ink bg-cream font-body text-ink focus:bg-white focus:border-coral transition-colors ${
                inputShake ? "animate-shake" : ""
              }`}
            />
            <button
              onClick={handleSubmit}
              disabled={!answer.trim()}
              className="btn-press flex-shrink-0 flex items-center gap-1 px-5 py-3 bg-coral text-white font-display rounded-doodle border-2 border-ink shadow-soft disabled:opacity-40 whitespace-nowrap"
            >
              <Send size={18} />
              确定
            </button>
          </div>
        ) : waitingForOpponent ? (
          <div className="flex items-center justify-center gap-2 py-3 text-ink-muted">
            <Loader2 size={20} className="animate-spin" />
            <span className="font-body text-sm">
              等待 {opponent?.nickname || "对手"} 答题...
            </span>
          </div>
        ) : isRevealed && quizReveal ? (
          <div className="space-y-2">
            {/* 对手结果 */}
            <div
              className={`flex items-center justify-between p-2.5 rounded-doodle border-2 ${
                quizReveal.opponentCorrect
                  ? "border-mint bg-mint/10"
                  : "border-coral bg-coral/10"
              }`}
            >
              <span className="text-sm font-body text-ink">
                {opponent?.nickname || "对手"}：{quizReveal.opponentAnswer || "（未作答）"}
              </span>
              {quizReveal.opponentCorrect ? (
                <Check size={18} className="text-mint" />
              ) : (
                <X size={18} className="text-coral" />
              )}
            </div>
            {/* 下一题按钮 */}
            <button
              onClick={handleNext}
              className="btn-press w-full py-3 bg-ink text-cream font-display text-lg rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-2"
            >
              {q.questionIndex + 1 >= q.totalQuestions ? "查看本轮结果" : "下一题"}
              <ArrowRight size={20} />
            </button>
          </div>
        ) : null}

        {/* 对手答题状态指示 */}
        {!isAnswered && opponentAnswered && (
          <div className="mt-2 text-center text-xs text-mint flex items-center justify-center gap-1">
            <Check size={14} />
            {opponent?.nickname || "对手"} 已答完，等你了
          </div>
        )}
      </div>
    </div>
  );
}
