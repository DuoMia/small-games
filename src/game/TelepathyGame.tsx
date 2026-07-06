import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Check, Loader2, ArrowRight, RotateCcw, LogOut, Trophy } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import Confetti from "@/components/Confetti";

// 默契考验每题限时（秒）
const CHOICE_TIME = 15;
// 揭晓后多久可以点"下一题"（毫秒）
const NEXT_BUTTON_DELAY = 2000;
// 选项字母
const OPTION_LETTERS = ["A", "B", "C", "D", "E"];

export default function TelepathyGame({ roomId }: { roomId: string }) {
  const { phase } = useGameStore();

  // 根据阶段分发
  if (phase === "GAME_OVER") {
    return <TelepathyResult roomId={roomId} />;
  }
  if (phase === "QUIZ") {
    return <RevealPhase roomId={roomId} />;
  }
  // DRAWING = 选择中
  return <ChoosingPhase roomId={roomId} />;
}

// ============ 选择阶段 ============
function ChoosingPhase({ roomId }: { roomId: string }) {
  const {
    telepathyQuestion: q,
    telepathyOpponentChose,
    room,
    myId,
  } = useGameStore();
  const { telepathyChoose } = useRoomActions();
  const { sfxEnabled } = useAudioStore();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const [selected, setSelected] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(CHOICE_TIME);
  const submittedRef = useRef(false);
  const lastSecRef = useRef<number>(-1);

  const opponent = room?.players.find((p) => p.id !== myId);

  // 切题时重置
  useEffect(() => {
    setSelected(null);
    submittedRef.current = false;
    setTimeLeft(CHOICE_TIME);
    lastSecRef.current = Math.ceil(CHOICE_TIME);
  }, [q?.questionIndex]);

  // 倒计时驱动
  useEffect(() => {
    if (!q) return;
    if (selected !== null) return; // 已选完，停止倒计时

    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, CHOICE_TIME - elapsed);
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
      // 超时自动选择 E（最后一个选项）
      if (left <= 0 && !submittedRef.current) {
        submittedRef.current = true;
        const defaultChoice = (q.options.length || 5) - 1;
        setSelected(defaultChoice);
        telepathyChoose(roomId, q.questionIndex, defaultChoice);
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.questionIndex, selected, roomId, sfxEnabled]);

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

  const handleSelect = (idx: number) => {
    if (selected !== null) return; // 已选过
    submittedRef.current = true;
    setSelected(idx);
    playSfx(sfx.click);
    telepathyChoose(roomId, q.questionIndex, idx);
  };

  const isChosen = selected !== null;
  const seconds = Math.ceil(timeLeft);
  const isUrgent = seconds <= 3 && seconds > 0 && !isChosen;

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Heart size={16} className="text-coral" />
          <span className="font-display text-ink text-sm">默契考验</span>
        </div>
        <div className="font-display text-ink text-sm bg-coral-light px-3 py-1 rounded-full border-2 border-ink">
          第 {q.questionIndex + 1} / {q.totalQuestions} 题
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
            className={`h-full rounded-full transition-all duration-100 ${
              isUrgent ? "bg-coral" : "bg-mint"
            }`}
            style={{ width: `${(timeLeft / CHOICE_TIME) * 100}%` }}
          />
        </div>
      </div>

      {/* 题目 */}
      <div className="flex-shrink-0 px-4 pt-2 pb-2 text-center">
        <div className="bg-white rounded-blob border-3 border-ink shadow-card px-5 py-3 inline-block">
          <p className="font-display text-xl text-ink leading-tight">
            {q.question}
          </p>
        </div>
      </div>

      {/* 选项 */}
      <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
        <div className="grid grid-cols-1 gap-2 max-w-md mx-auto">
          {q.options.map((opt, idx) => {
            const isMyChoice = selected === idx;
            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                disabled={isChosen}
                className={`flex items-center gap-3 px-4 py-3 rounded-doodle border-2 font-body transition-all text-left ${
                  isChosen
                    ? isMyChoice
                      ? "bg-coral text-white border-ink shadow-soft"
                      : "bg-cream text-ink-muted border-ink/20 opacity-60"
                    : "bg-white text-ink border-ink/30 btn-press hover:border-coral"
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full border-2 border-ink font-display text-sm flex-shrink-0 ${
                    isChosen && isMyChoice
                      ? "bg-white text-coral"
                      : "bg-sun text-ink"
                  }`}
                >
                  {OPTION_LETTERS[idx]}
                </div>
                <span className="flex-1">{opt}</span>
                {isMyChoice && <Check size={18} className="text-white" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部状态 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-4 py-3">
        {isChosen ? (
          <div className="flex items-center justify-center gap-2 py-1">
            {telepathyOpponentChose ? (
              <span className="font-display text-mint flex items-center gap-1.5">
                <Check size={18} />
                对方也选好了，揭晓中...
              </span>
            ) : (
              <>
                <Loader2 size={18} className="animate-spin text-ink-muted" />
                <span className="font-body text-sm text-ink-muted">
                  等待 {opponent?.nickname || "对方"} 选择...
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="text-center text-xs text-ink-muted">
            {telepathyOpponentChose ? (
              <span className="text-mint flex items-center justify-center gap-1">
                <Check size={14} />
                {opponent?.nickname || "对方"} 已选好，等你了
              </span>
            ) : (
              <span>选择你的答案 · 超时默认选 E</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 揭晓阶段 ============
function RevealPhase({ roomId }: { roomId: string }) {
  const {
    telepathyReveal: reveal,
    telepathyQuestion: q,
    room,
    myId,
  } = useGameStore();
  const { telepathyNext } = useRoomActions();
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

  const matchText =
    reveal.match === "full"
      ? "心有灵犀！"
      : reveal.match === "partial"
      ? "差一点！"
      : "完全没默契";
  const matchColor =
    reveal.match === "full"
      ? "text-mint"
      : reveal.match === "partial"
      ? "text-sun"
      : "text-coral";
  const matchBg =
    reveal.match === "full"
      ? "bg-mint/20 border-mint"
      : reveal.match === "partial"
      ? "bg-sun/20 border-sun"
      : "bg-coral/20 border-coral";
  const matchEmoji = reveal.match === "full" ? "💕" : reveal.match === "partial" ? "🤏" : "💔";

  const handleNext = () => {
    if (!canNext) return;
    playSfx(sfx.click);
    telepathyNext(roomId);
  };

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Heart size={16} className="text-coral" />
          <span className="font-display text-ink text-sm">默契考验</span>
        </div>
        <div className="font-display text-ink text-sm bg-coral-light px-3 py-1 rounded-full border-2 border-ink">
          第 {q.questionIndex + 1} / {q.totalQuestions} 题
        </div>
      </div>

      {/* 题目 */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 text-center">
        <div className="bg-white rounded-blob border-3 border-ink shadow-card px-5 py-2 inline-block">
          <p className="font-display text-lg text-ink leading-tight">
            {q.question}
          </p>
        </div>
      </div>

      {/* 匹配结果 */}
      <div className="flex-shrink-0 px-4 py-2 text-center animate-bounce-in">
        <div className={`inline-block px-4 py-1.5 rounded-doodle border-2 ${matchBg}`}>
          <span className={`font-display text-lg ${matchColor} flex items-center gap-1.5`}>
            <span className="text-2xl">{matchEmoji}</span>
            {matchText}
            <span className="text-sm text-ink-muted ml-1">
              {reveal.match === "full" ? "+10" : reveal.match === "partial" ? "+5" : "+0"} 分
            </span>
          </span>
        </div>
      </div>

      {/* 双方选择 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        <div className="max-w-md mx-auto space-y-3">
          {/* 我的选择 */}
          <div
            className={`flex items-center gap-3 p-3 rounded-doodle border-2 ${
              reveal.match === "full"
                ? "border-mint bg-mint/10"
                : reveal.match === "partial"
                ? "border-sun bg-sun/10"
                : "border-coral bg-coral/10"
            } animate-slide-up`}
          >
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-coral text-white font-display text-sm border-2 border-ink flex-shrink-0">
              我
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-ink-muted">你选了</div>
              <div className="font-display text-ink flex items-center gap-1.5">
                <span className="bg-sun text-ink w-6 h-6 rounded-full border border-ink flex items-center justify-center text-xs">
                  {OPTION_LETTERS[reveal.myChoice]}
                </span>
                <span className="truncate">{q.options[reveal.myChoice]}</span>
              </div>
            </div>
            <div className="font-display text-coral text-xl flex-shrink-0">
              +{reveal.myScore}
            </div>
          </div>

          {/* 对手选择 */}
          <div
            className={`flex items-center gap-3 p-3 rounded-doodle border-2 ${
              reveal.match === "full"
                ? "border-mint bg-mint/10"
                : reveal.match === "partial"
                ? "border-sun bg-sun/10"
                : "border-coral bg-coral/10"
            } animate-slide-up`}
            style={{ animationDelay: "0.15s" }}
          >
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-mint text-ink font-display text-sm border-2 border-ink flex-shrink-0">
              {(opponent?.nickname || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-ink-muted">
                {opponent?.nickname || "对方"}选了
              </div>
              <div className="font-display text-ink flex items-center gap-1.5">
                <span className="bg-sun text-ink w-6 h-6 rounded-full border border-ink flex items-center justify-center text-xs">
                  {OPTION_LETTERS[reveal.opponentChoice]}
                </span>
                <span className="truncate">{q.options[reveal.opponentChoice]}</span>
              </div>
            </div>
            <div className="font-display text-coral text-xl flex-shrink-0">
              +{reveal.opponentScore}
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
              {isLast ? "查看最终默契度" : "下一题"}
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
function TelepathyResult({ roomId }: { roomId: string }) {
  const { gameOver, room, myId } = useGameStore();
  const { telepathyRestart, leaveRoom } = useRoomActions();
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

  // 默契度：双方总分平均值占满分（每题 10 分 * 题数）的百分比
  const totalQuestions = 10;
  const maxScore = totalQuestions * 10;
  const totalScore = finalScores.reduce((sum, p) => sum + p.totalScore, 0);
  const avgScore = finalScores.length > 0 ? totalScore / finalScores.length : 0;
  const telepathyPercent = Math.round((avgScore / maxScore) * 100);

  // 默契度评级
  let grade = "";
  let gradeEmoji = "";
  if (telepathyPercent >= 80) {
    grade = "心有灵犀";
    gradeEmoji = "💕";
  } else if (telepathyPercent >= 60) {
    grade = "默契不错";
    gradeEmoji = "😊";
  } else if (telepathyPercent >= 40) {
    grade = "还需磨合";
    gradeEmoji = "🤔";
  } else {
    grade = "毫无默契";
    gradeEmoji = "💔";
  }

  const sortedScores = [...finalScores].sort((a, b) => b.totalScore - a.totalScore);

  const handleLeave = () => {
    playSfx(sfx.click);
    leaveRoom(roomId);
    navigate("/");
  };

  const handleRestart = () => {
    playSfx(sfx.click);
    telepathyRestart(roomId);
  };

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8 relative">
      {/* 彩屑 */}
      {!isDraw && telepathyPercent >= 60 && <Confetti />}

      <div className="w-full max-w-md relative z-10">
        {/* 默契度展示 */}
        <div className="text-center mb-6 animate-bounce-in">
          <div className="text-6xl mb-2 animate-float">{gradeEmoji}</div>
          <h1 className="font-display text-4xl text-coral">{grade}</h1>
          <p className="text-ink-muted mt-2 text-sm">默契考验完成</p>
        </div>

        {/* 默契度百分比 */}
        <div className="bg-white rounded-blob border-3 border-ink shadow-card p-5 mb-4 text-center">
          <p className="font-body text-ink-muted text-sm mb-1">默契度</p>
          <div className="font-display text-6xl text-ink leading-none">
            {telepathyPercent}
            <span className="text-3xl text-ink-muted">%</span>
          </div>
          {/* 进度条 */}
          <div className="mt-3 h-3 bg-cream-dark rounded-full overflow-hidden border border-ink/20">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                telepathyPercent >= 80
                  ? "bg-mint"
                  : telepathyPercent >= 60
                  ? "bg-sun"
                  : telepathyPercent >= 40
                  ? "bg-coral"
                  : "bg-ink-muted"
              }`}
              style={{ width: `${Math.min(100, telepathyPercent)}%` }}
            />
          </div>
        </div>

        {/* 胜负宣告 */}
        <div className="text-center mb-4">
          {isDraw ? (
            <p className="font-display text-xl text-ink">🤝 平局！</p>
          ) : isWinner ? (
            <p className="font-display text-xl text-coral">
              🏆 你赢了！
            </p>
          ) : (
            <p className="font-display text-xl text-ink">
              💪 {sortedScores[0]?.nickname} 获胜
            </p>
          )}
        </div>

        {/* 双方得分 */}
        <div className="bg-white rounded-doodle border-2 border-ink shadow-soft p-4 mb-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Trophy size={18} className="text-sun" />
            <h2 className="font-display text-ink text-sm">双方得分</h2>
          </div>
          <div className="space-y-2">
            {sortedScores.map((player, idx) => (
              <div
                key={player.id}
                className={`flex items-center gap-3 p-2.5 rounded-doodle border-2 ${
                  player.id === winnerId
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
                    {player.id === myId && (
                      <span className="text-xs text-coral ml-1">(我)</span>
                    )}
                  </span>
                </div>
                <div className="font-display text-2xl text-coral">
                  {player.totalScore}
                </div>
                <div className="text-xs text-ink-muted">分</div>
              </div>
            ))}
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
