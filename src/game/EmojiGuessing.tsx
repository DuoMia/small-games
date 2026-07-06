import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Smile, Check, Loader2, ArrowRight, RotateCcw, LogOut, Trophy, Send } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import Confetti from "@/components/Confetti";

// 揭晓后多久可以点"下一题"（毫秒）
const NEXT_BUTTON_DELAY = 2000;

export default function EmojiGuessing({ roomId }: { roomId: string }) {
  const { phase } = useGameStore();

  // 根据阶段分发
  if (phase === "GAME_OVER") {
    return <EmojiResult roomId={roomId} />;
  }
  if (phase === "QUIZ") {
    return <EmojiRevealPhase roomId={roomId} />;
  }
  // DRAWING = 答题中
  return <EmojiAnsweringPhase roomId={roomId} />;
}

// ============ 答题阶段 ============
function EmojiAnsweringPhase({ roomId }: { roomId: string }) {
  const {
    emojiQuestion: q,
    emojiOpponentAnswered,
    room,
    myId,
  } = useGameStore();
  const { emojiSubmit } = useRoomActions();
  const { sfxEnabled } = useAudioStore();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const [guess, setGuess] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(q?.timeLimit ?? 30);
  const submittedRef = useRef(false);
  const lastSecRef = useRef<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const opponent = room?.players.find((p) => p.id !== myId);
  const timeLimit = q?.timeLimit ?? 30;

  // 切题时重置
  useEffect(() => {
    setGuess("");
    setSubmitted(false);
    submittedRef.current = false;
    setTimeLeft(timeLimit);
    lastSecRef.current = Math.ceil(timeLimit);
    // 自动聚焦输入框
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [q?.questionIndex, timeLimit]);

  // 倒计时驱动
  useEffect(() => {
    if (!q) return;
    if (submitted) return; // 已提交，停止倒计时

    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, timeLimit - elapsed);
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
      // 超时自动提交空字符串
      if (left <= 0 && !submittedRef.current) {
        submittedRef.current = true;
        setSubmitted(true);
        playSfx(sfx.roundEnd);
        emojiSubmit(roomId, q.questionIndex, "");
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.questionIndex, submitted, roomId, sfxEnabled]);

  if (!q) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin text-coral mx-auto mb-3" />
          <p className="text-ink-muted">准备题目...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    if (submitted) return;
    submittedRef.current = true;
    setSubmitted(true);
    playSfx(sfx.click);
    emojiSubmit(roomId, q.questionIndex, guess.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const seconds = Math.ceil(timeLeft);
  const isUrgent = seconds <= 3 && seconds > 0 && !submitted;

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Smile size={16} className="text-coral" />
          <span className="font-display text-ink text-sm">表情包猜词</span>
        </div>
        <div className="font-display text-ink text-sm bg-coral-light px-3 py-1 rounded-full border-2 border-ink">
          第 {q.questionIndex + 1} / {q.totalQuestions} 题
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
            style={{ width: `${(timeLeft / timeLimit) * 100}%` }}
          />
        </div>
      </div>

      {/* emoji 展示 */}
      <div className="flex-shrink-0 px-4 py-3 text-center">
        <div className="inline-block bg-sun/30 px-3 py-1 rounded-full border-2 border-ink/30 font-body text-xs text-ink-muted mb-3">
          分类：{q.category}
        </div>
        <div className="bg-white rounded-blob border-3 border-ink shadow-card px-5 py-6 inline-block">
          <p className="text-6xl leading-tight select-all">{q.emoji}</p>
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
        </div>
      </div>

      {/* 底部状态 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-4 py-3">
        {submitted ? (
          <div className="flex items-center justify-center gap-2 py-1">
            {emojiOpponentAnswered ? (
              <span className="font-display text-mint flex items-center gap-1.5">
                <Check size={18} />
                对方也答完了，揭晓中...
              </span>
            ) : (
              <>
                <Loader2 size={18} className="animate-spin text-ink-muted" />
                <span className="font-body text-sm text-ink-muted">
                  已提交，等待 {opponent?.nickname || "对方"} 作答...
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="text-center text-xs text-ink-muted">
            {emojiOpponentAnswered ? (
              <span className="text-mint flex items-center justify-center gap-1">
                <Check size={14} />
                {opponent?.nickname || "对方"} 已答完，等你了
              </span>
            ) : (
              <span>输入你的猜测 · 超时自动提交空答案</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 揭晓阶段 ============
function EmojiRevealPhase({ roomId }: { roomId: string }) {
  const {
    emojiReveal: reveal,
    emojiQuestion: q,
    room,
    myId,
  } = useGameStore();
  const { emojiNext } = useRoomActions();
  const { sfxEnabled } = useAudioStore();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const [canNext, setCanNext] = useState(false);

  // 揭晓后 2 秒允许点"下一题"
  useEffect(() => {
    if (!reveal) return;
    setCanNext(false);
    const timer = setTimeout(() => setCanNext(true), NEXT_BUTTON_DELAY);
    return () => clearTimeout(timer);
  }, [reveal?.questionIndex]);

  if (!reveal || !q) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-coral" />
      </div>
    );
  }

  const opponent = room?.players.find((p) => p.id !== myId);
  const isLast = q.questionIndex + 1 >= q.totalQuestions;

  const handleNext = () => {
    if (!canNext) return;
    playSfx(sfx.click);
    emojiNext(roomId);
  };

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Smile size={16} className="text-coral" />
          <span className="font-display text-ink text-sm">表情包猜词</span>
        </div>
        <div className="font-display text-ink text-sm bg-coral-light px-3 py-1 rounded-full border-2 border-ink">
          第 {q.questionIndex + 1} / {q.totalQuestions} 题
        </div>
      </div>

      {/* emoji + 正确答案 */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 text-center">
        <div className="bg-white rounded-blob border-3 border-ink shadow-card px-5 py-3 inline-block mb-2">
          <p className="text-4xl leading-tight">{q.emoji}</p>
        </div>
        <div className="bg-mint/20 px-4 py-1.5 rounded-doodle border-2 border-mint inline-block animate-bounce-in">
          <span className="font-display text-ink flex items-center gap-1.5">
            <Check size={16} className="text-mint" />
            正确答案：
            <span className="text-mint">{reveal.answer}</span>
          </span>
        </div>
      </div>

      {/* 双方回答 + 本题得分 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        <div className="max-w-md mx-auto space-y-3">
          {/* 我的回答 */}
          <div
            className={`flex items-center gap-3 p-3 rounded-doodle border-2 animate-slide-up ${
              reveal.myCorrect
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
                  reveal.myCorrect ? "text-mint" : "text-coral"
                }`}
              >
                <span className="truncate">
                  {reveal.myGuess || "(空)"}
                </span>
                {reveal.myCorrect && <Check size={16} />}
              </div>
            </div>
            <div
              className={`font-display text-xl flex-shrink-0 ${
                reveal.myCorrect ? "text-mint" : "text-coral"
              }`}
            >
              +{reveal.myScore}
            </div>
          </div>

          {/* 对手回答 */}
          <div
            className={`flex items-center gap-3 p-3 rounded-doodle border-2 animate-slide-up ${
              reveal.opponentCorrect
                ? "border-mint bg-mint/10"
                : "border-coral bg-coral/10"
            }`}
            style={{ animationDelay: "0.15s" }}
          >
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-mint text-ink font-display text-sm border-2 border-ink flex-shrink-0">
              {(opponent?.nickname || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-ink-muted">
                {opponent?.nickname || "对方"}的回答
              </div>
              <div
                className={`font-display flex items-center gap-1.5 ${
                  reveal.opponentCorrect ? "text-mint" : "text-coral"
                }`}
              >
                <span className="truncate">
                  {reveal.opponentGuess || "(空)"}
                </span>
                {reveal.opponentCorrect && <Check size={16} />}
              </div>
            </div>
            <div
              className={`font-display text-xl flex-shrink-0 ${
                reveal.opponentCorrect ? "text-mint" : "text-coral"
              }`}
            >
              +{reveal.opponentScore}
            </div>
          </div>

          {/* 累计总分对比 */}
          <div className="bg-white rounded-doodle border-2 border-ink shadow-soft p-3 animate-slide-up" style={{ animationDelay: "0.3s" }}>
            <div className="flex items-center justify-center gap-2 mb-2">
              <Trophy size={16} className="text-sun" />
              <span className="font-display text-ink text-sm">累计总分</span>
            </div>
            <div className="flex items-center justify-around">
              <div className="text-center">
                <div className="text-xs text-ink-muted mb-0.5">我</div>
                <div className="font-display text-2xl text-coral">
                  {reveal.myTotal}
                </div>
              </div>
              <div className="font-display text-xl text-ink-muted">:</div>
              <div className="text-center">
                <div className="text-xs text-ink-muted mb-0.5">
                  {opponent?.nickname || "对方"}
                </div>
                <div className="font-display text-2xl text-ink">
                  {reveal.opponentTotal}
                </div>
              </div>
            </div>
          </div>
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

// ============ 最终结果 ============
function EmojiResult({ roomId }: { roomId: string }) {
  const { gameOver, room, myId } = useGameStore();
  const { emojiRestart, leaveRoom } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  if (!gameOver) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-coral" />
      </div>
    );
  }

  const { finalScores, winnerId } = gameOver;
  const isHost = room?.hostId === myId;
  const isWinner = winnerId === myId;
  const isDraw = !winnerId;

  const sortedScores = [...finalScores].sort((a, b) => b.totalScore - a.totalScore);
  const maxScore = sortedScores[0]?.totalScore ?? 0;

  const handleLeave = () => {
    playSfx(sfx.click);
    leaveRoom(roomId);
    navigate("/");
  };

  const handleRestart = () => {
    playSfx(sfx.click);
    emojiRestart(roomId);
  };

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8 relative">
      {/* 彩屑 */}
      {!isDraw && isWinner && <Confetti />}

      <div className="w-full max-w-md relative z-10">
        {/* 胜负展示 */}
        <div className="text-center mb-6 animate-bounce-in">
          <div className="text-6xl mb-2 animate-float">
            {isDraw ? "🤝" : isWinner ? "🏆" : "💪"}
          </div>
          <h1 className="font-display text-4xl text-coral">
            {isDraw ? "平局！" : isWinner ? "你赢了！" : "再接再厉！"}
          </h1>
          <p className="text-ink-muted mt-2 text-sm">表情包猜词完成</p>
        </div>

        {/* 双方得分 */}
        <div className="bg-white rounded-doodle border-2 border-ink shadow-soft p-4 mb-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Trophy size={18} className="text-sun" />
            <h2 className="font-display text-ink text-sm">最终总分</h2>
          </div>
          <div className="space-y-2">
            {sortedScores.map((player, idx) => {
              const isMe = player.id === myId;
              const isTopScore = player.totalScore === maxScore;
              return (
                <div
                  key={player.id}
                  className={`flex items-center gap-3 p-2.5 rounded-doodle border-2 ${
                    isTopScore
                      ? "border-sun bg-sun/10"
                      : "border-ink/20 bg-cream"
                  }`}
                >
                  <div
                    className={`flex items-center justify-center w-7 h-7 rounded-full font-display text-xs border-2 border-ink ${
                      idx === 0 ? "bg-sun text-ink" : "bg-cream-dark text-ink"
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <span className="font-display text-ink text-sm">
                      {player.nickname}
                      {isMe && (
                        <span className="text-xs text-coral ml-1">(我)</span>
                      )}
                    </span>
                  </div>
                  <div className="font-display text-2xl text-coral">
                    {player.totalScore}
                  </div>
                  <div className="text-xs text-ink-muted">分</div>
                </div>
              );
            })}
          </div>
          {/* 满分参考 */}
          <div className="mt-3 text-center text-xs text-ink-muted">
            满分 {10 * 10} 分 · 共 10 题
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="space-y-3">
          {isHost ? (
            <button
              onClick={handleRestart}
              className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2"
            >
              <RotateCcw size={22} />
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
