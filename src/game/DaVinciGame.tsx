import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCcw, LogOut, HelpCircle, ArrowRight, Check, X } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import Confetti from "@/components/Confetti";
import type { DaVinciCard, DaVinciColor } from "@/lib/types";

const COLOR_STYLES: Record<DaVinciColor, { bg: string; text: string; border: string; label: string }> = {
  black: { bg: "bg-slate-900", text: "text-white", border: "border-slate-700", label: "黑" },
  white: { bg: "bg-white", text: "text-slate-900", border: "border-slate-300", label: "白" },
};

const UNKNOWN_COLOR = "bg-gradient-to-br from-rose-200 to-rose-100";

export default function DaVinciGame({ roomId }: { roomId: string }) {
  const { phase, dvGameOver } = useGameStore();
  if (phase === "GAME_OVER" || dvGameOver) {
    return <DaVinciResult roomId={roomId} />;
  }
  return <DaVinciPlaying roomId={roomId} />;
}

function DaVinciCardTile({
  card,
  isMine,
  isSelected,
  isNewlyRevealed,
  onClick,
  clickable,
  isDrawn,
  wrongGuesses,
}: {
  card: DaVinciCard;
  isMine: boolean;
  isSelected?: boolean;
  isNewlyRevealed?: boolean;
  onClick?: () => void;
  clickable?: boolean;
  isDrawn?: boolean;
  wrongGuesses?: number[];
}) {
  const isUnknown = !isMine && !card.revealed;
  const style = isUnknown
    ? { bg: UNKNOWN_COLOR, text: "text-rose-900/70", border: "border-rose-300" }
    : COLOR_STYLES[card.color];

  const numberDisplay = card.revealed || isMine ? card.number : "?";

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        disabled={!clickable}
        className={`
          relative rounded-xl border-[3px] shadow-card transition-all duration-200
          flex flex-col items-center justify-center
          ${style.bg} ${style.text} ${style.border}
          ${clickable ? "hover:scale-105 hover:-translate-y-1 cursor-pointer" : "cursor-default"}
          ${isSelected ? "ring-4 ring-amber-400 scale-105 -translate-y-1" : ""}
          ${isNewlyRevealed ? "animate-[flipIn_0.5s_ease-out]" : ""}
          ${isDrawn ? "ring-2 ring-amber-300 animate-pulse" : ""}
        `}
        style={{ width: 56, height: 80 }}
      >
        <span className="text-xs opacity-60 leading-none">{COLOR_STYLES[card.color].label}</span>
        <span className="text-2xl font-black leading-none mt-1">{numberDisplay}</span>
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

function DrawnCardPreview({ card, onClose }: { card: { color: DaVinciColor; number: number }; onClose: () => void }) {
  const style = COLOR_STYLES[card.color];
  return (
    <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-[fadeIn_0.2s]">
      <div className="bg-white rounded-3xl p-8 shadow-pop flex flex-col items-center gap-4 animate-[popIn_0.3s_ease-out]">
        <h3 className="text-xl font-bold text-ink">你摸到了一张新牌</h3>
        <p className="text-sm text-ink/60">将其保密，准备猜牌</p>
        <div
          className={`${style.bg} ${style.text} ${style.border} border-[3px] rounded-2xl shadow-card
            flex flex-col items-center justify-center`}
          style={{ width: 84, height: 120 }}
        >
          <span className="text-sm opacity-70">{style.label}</span>
          <span className="text-4xl font-black">{card.number}</span>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-2 bg-mint text-white font-bold rounded-full px-6 py-2.5 shadow-pop hover:brightness-110 active:scale-95 transition-all"
        >
          知道了 <Check className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function GuessNumberModal({
  onSubmit,
  onCancel,
  color,
}: {
  onSubmit: (n: number) => void;
  onCancel: () => void;
  color?: DaVinciColor;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const btnStyle = color === "black"
    ? "bg-slate-900 text-white border-slate-700"
    : color === "white"
      ? "bg-white text-slate-900 border-slate-300"
      : "bg-white text-ink border-ink/20";

  return (
    <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-center justify-center animate-[fadeIn_0.2s] p-4">
      <div className="bg-cream rounded-3xl p-6 shadow-pop max-w-sm w-full">
        <h3 className="text-xl font-bold text-ink text-center mb-1">猜一个数字</h3>
        <p className="text-sm text-ink/60 text-center mb-4">0-11 之间，猜中则破译成功</p>
        <div className="grid grid-cols-6 gap-2 mb-4">
          {Array.from({ length: 12 }, (_, i) => i).map((n) => (
            <button
              key={n}
              onClick={() => setSelected(n)}
              className={`
                h-11 rounded-lg border-2 font-bold text-lg transition-all
                ${btnStyle}
                ${selected === n ? "ring-4 ring-amber-400 scale-110 -translate-y-1" : "hover:scale-105"}
              `}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-full border-2 border-ink/20 text-ink/70 font-bold hover:bg-ink/5 active:scale-95 transition-all"
          >
            取消
          </button>
          <button
            onClick={() => selected !== null && onSubmit(selected)}
            disabled={selected === null}
            className="flex-1 py-2.5 rounded-full bg-coral text-white font-bold shadow-pop hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultToast({ result }: { result: { correct: boolean; guesserNickname: string; guessedNumber: number } }) {
  return (
    <div
      className={`
        fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30
        rounded-2xl px-6 py-4 shadow-pop text-center animate-[popIn_0.3s_ease-out]
        ${result.correct ? "bg-mint" : "bg-coral"} text-white
      `}
    >
      <div className="text-2xl font-black mb-1">
        {result.correct ? "破译成功！" : "破译失败！"}
      </div>
      <div className="text-sm opacity-90">
        {result.guesserNickname} 猜 <b className="text-lg">{result.guessedNumber}</b>
      </div>
    </div>
  );
}

function DaVinciPlaying({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);
  const dvState = useGameStore((s) => s.dvState);
  const dvResult = useGameStore((s) => s.dvResult);
  const dvOppDrewColor = useGameStore((s) => s.dvOppDrewColor);
  const dvSelfDrewCard = useGameStore((s) => s.dvSelfDrewCard);
  const dvPassedPlayerId = useGameStore((s) => s.dvPassedPlayerId);
  const error = useGameStore((s) => s.error);
  const setError = useGameStore((s) => s.setError);
  const setDvSelfDrewCard = useGameStore((s) => s.setDvSelfDrewCard);

  const { dvDraw, dvGuess, dvPass, leaveRoom } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const playSfx = useCallback(
    (fn: () => void) => {
      if (sfxEnabled) fn();
    },
    [sfxEnabled]
  );

  const [selectedTargetCard, setSelectedTargetCard] = useState<number | null>(null);
  const [showGuessModal, setShowGuessModal] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showOpponentDrew, setShowOpponentDrew] = useState(false);
  const [showPassedHint, setShowPassedHint] = useState(false);
  // 错误猜测记录：cardId -> 猜过的数字列表
  const [wrongGuesses, setWrongGuesses] = useState<Record<string, number[]>>({});

  const me = room?.players.find((p) => p.id === myId);
  const opponent = room?.players.find((p) => p.id !== myId);

  // 监听自己摸牌
  useEffect(() => {
    if (dvSelfDrewCard) {
      playSfx(sfx.click);
    }
  }, [dvSelfDrewCard, playSfx]);

  // 监听对方摸牌
  useEffect(() => {
    if (dvOppDrewColor) {
      setShowOpponentDrew(true);
      playSfx(sfx.opponentAnswered);
      const t = setTimeout(() => setShowOpponentDrew(false), 1200);
      return () => clearTimeout(t);
    }
  }, [dvOppDrewColor, playSfx]);

  // 监听 pass 提示
  useEffect(() => {
    if (dvPassedPlayerId) {
      setShowPassedHint(true);
      const t = setTimeout(() => setShowPassedHint(false), 1500);
      return () => clearTimeout(t);
    }
  }, [dvPassedPlayerId]);

  // 监听猜牌结果
  useEffect(() => {
    if (dvResult) {
      setShowResult(true);
      setSelectedTargetCard(null);
      setShowGuessModal(false);
      // 猜错时记录错误猜测数字
      if (!dvResult.correct && dvResult.targetCardId) {
        setWrongGuesses((prev) => {
          const existing = prev[dvResult.targetCardId!] || [];
          if (existing.includes(dvResult.guessedNumber)) return prev;
          return { ...prev, [dvResult.targetCardId!]: [...existing, dvResult.guessedNumber] };
        });
      }
      const t = setTimeout(() => setShowResult(false), 1500);
      return () => clearTimeout(t);
    } else {
      setShowResult(false);
      setWrongGuesses({});
    }
  }, [dvResult]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 2000);
      return () => clearTimeout(t);
    }
  }, [error, setError]);

  if (!room || !dvState || !me || !opponent) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center text-ink/60">
        等待游戏开始…
      </div>
    );
  }

  const myTurn = dvState.myTurn;
  const phase = dvState.phase;
  const canDraw = myTurn && phase === "draw";
  const canGuess = myTurn && phase === "guess";
  const canContinue = dvState.canContinue;

  const handleDraw = () => {
    playSfx(sfx.click);
    dvDraw(roomId);
  };

  const handleCardClick = (idx: number) => {
    if (!canGuess) return;
    const card = dvState.opponentHand[idx];
    if (card.revealed) return;
    playSfx(sfx.click);
    setSelectedTargetCard(idx);
    setShowGuessModal(true);
  };

  const handleGuess = (n: number) => {
    if (selectedTargetCard === null) return;
    dvGuess(roomId, opponent.id, selectedTargetCard, n);
  };

  const handlePass = () => {
    playSfx(sfx.click);
    dvPass(roomId);
    setSelectedTargetCard(null);
  };

  const handleLeave = () => {
    leaveRoom(roomId);
    navigate("/");
  };

  const oppCardAtIdx = (i: number): DaVinciCard | undefined => dvState.opponentHand[i];
  const selectedColor = selectedTargetCard !== null ? oppCardAtIdx(selectedTargetCard)?.color : undefined;

  return (
    <div className="min-h-screen bg-cream flex flex-col relative overflow-hidden">
      {/* 顶部栏 */}
      <header className="flex items-center justify-between px-4 py-3 bg-white/60 backdrop-blur-sm border-b border-ink/10 z-10">
        <button
          onClick={handleLeave}
          className="w-10 h-10 rounded-full border-2 border-ink/10 flex items-center justify-center text-ink/60 hover:bg-white hover:text-coral transition-all"
        >
          <LogOut className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full bg-ink text-white font-bold">达芬奇密码</span>
          <span className="text-sm text-ink/60">房间 {room.roomId}</span>
        </div>
        <div className="w-10 h-10 flex items-center justify-center text-ink/40">
          <HelpCircle className="w-5 h-5" />
        </div>
      </header>

      {/* 对方区域 */}
      <section className="px-4 py-3">
        <PlayerBar
          nickname={opponent.nickname}
          isHost={opponent.isHost}
          active={!myTurn && phase !== "end"}
          revealedCount={dvState.opponentHand.filter((c) => c.revealed).length}
          totalCount={dvState.opponentHand.length}
          side="top"
        />
        <div className="mt-3 flex flex-wrap justify-center gap-2 min-h-[90px] items-center">
          {dvState.opponentHand.map((card, i) => {
            const isSelected = selectedTargetCard === i;
            return (
              <DaVinciCardTile
                key={card.id}
                card={card}
                isMine={false}
                isSelected={isSelected}
                clickable={canGuess && !card.revealed}
                isNewlyRevealed={dvResult?.targetId === opponent.id && dvResult.targetCardIndex === i && dvResult.correct}
                wrongGuesses={wrongGuesses[card.id]}
                onClick={() => handleCardClick(i)}
              />
            );
          })}
        </div>
      </section>

      {/* 桌面中间：牌堆 + 提示 */}
      <section className="flex-1 flex flex-col items-center justify-center gap-4 px-4 relative">
        {/* 剩余牌堆 */}
        <div className="flex flex-col items-center gap-1">
          <div className="relative">
            <div className="absolute inset-0 translate-x-1 translate-y-1 bg-slate-700/30 rounded-xl" />
            <div className="relative w-14 h-20 rounded-xl bg-gradient-to-br from-amber-600 to-amber-800 border-[3px] border-amber-900 shadow-card flex items-center justify-center">
              <div className="text-amber-100 font-black text-xl">{dvState.deckCount}</div>
            </div>
          </div>
          <span className="text-xs text-ink/50">剩余牌堆</span>
        </div>

        {/* 回合提示 */}
        <div className="text-center">
          {myTurn ? (
            phase === "draw" ? (
              <div className="text-lg font-bold text-mint">轮到你摸牌</div>
            ) : (
              <div className="text-lg font-bold text-coral">
                {canContinue ? "猜对了！可以继续猜，或选择结束回合" : "选择对方的一张牌猜数字"}
              </div>
            )
          ) : (
            <div className="text-lg font-bold text-ink/60">
              {opponent.nickname} 的回合…
            </div>
          )}
        </div>

        {/* 操作按钮区 */}
        <div className="flex gap-3 items-center flex-wrap justify-center">
          {canDraw && (
            <button
              onClick={handleDraw}
              className="flex items-center gap-2 bg-coral text-white font-bold rounded-full px-8 py-3.5 shadow-pop hover:brightness-110 active:scale-95 transition-all text-lg"
            >
              摸牌
            </button>
          )}
          {canGuess && canContinue && (
            <button
              onClick={handlePass}
              className="flex items-center gap-2 bg-mint text-white font-bold rounded-full px-6 py-3 shadow-pop hover:brightness-110 active:scale-95 transition-all"
            >
              结束回合 <ArrowRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </section>

      {/* 我方区域 */}
      <section className="px-4 py-3 bg-white/40 backdrop-blur-sm border-t border-ink/10">
        <div className="flex flex-wrap justify-center gap-2 min-h-[90px] items-center mb-3">
          {dvState.myHand.map((card) => (
            <DaVinciCardTile
              key={card.id}
              card={card}
              isMine={true}
              isDrawn={dvState.myDrawnCard?.id === card.id}
              wrongGuesses={wrongGuesses[card.id]}
            />
          ))}
          {/* 我摸到但未入手牌的新牌（背面/已知） */}
          {dvState.myDrawnCard && !dvSelfDrewCard && (
            <div className="animate-pulse">
              <DaVinciCardTile card={dvState.myDrawnCard} isMine={true} isDrawn />
            </div>
          )}
        </div>
        <PlayerBar
          nickname={me.nickname}
          isHost={me.isHost}
          active={myTurn && phase !== "end"}
          revealedCount={dvState.myHand.filter((c) => c.revealed).length}
          totalCount={dvState.myHand.length}
          side="bottom"
        />
      </section>

      {/* 自己摸牌预览弹窗 */}
      {dvSelfDrewCard && (
        <DrawnCardPreview card={dvSelfDrewCard} onClose={() => setDvSelfDrewCard(null)} />
      )}

      {/* 猜数字弹窗 */}
      {showGuessModal && selectedTargetCard !== null && (
        <GuessNumberModal
          color={selectedColor}
          onSubmit={handleGuess}
          onCancel={() => {
            setShowGuessModal(false);
            setSelectedTargetCard(null);
          }}
        />
      )}

      {/* 猜牌结果 Toast */}
      {showResult && dvResult && <ResultToast result={dvResult} />}

      {/* 对方摸牌提示（小型非全局提示，显示在顶部对方区域下方） */}
      {showOpponentDrew && dvOppDrewColor && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-20 bg-white/90 rounded-full px-3 py-1 shadow-soft text-center animate-[popIn_0.3s] flex items-center gap-1.5">
          <span className="text-xs text-ink/60">{opponent.nickname} 摸了一张</span>
          <span className={`inline-block w-4 h-4 rounded ${dvOppDrewColor === "black" ? "bg-slate-900" : "bg-white border-2 border-slate-300"}`} />
        </div>
      )}

      {/* Pass 提示 */}
      {showPassedHint && dvPassedPlayerId && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-white/90 rounded-2xl px-5 py-3 shadow-pop text-center animate-[popIn_0.3s]">
          <div className="text-sm text-ink/70">
            {dvPassedPlayerId === myId ? "你" : opponent.nickname} 选择了结束回合
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-coral text-white text-sm px-4 py-2 rounded-full shadow-pop animate-[popIn_0.2s]">
          {error}
        </div>
      )}
    </div>
  );
}

function PlayerBar({
  nickname,
  isHost,
  active,
  revealedCount,
  totalCount,
  side,
}: {
  nickname: string;
  isHost: boolean;
  active: boolean;
  revealedCount: number;
  totalCount: number;
  side: "top" | "bottom";
}) {
  return (
    <div className={`flex items-center gap-3 ${side === "top" ? "" : "flex-row-reverse"}`}>
      <div
        className={`w-11 h-11 rounded-full flex items-center justify-center font-black text-white text-lg
          ${active ? "bg-coral ring-4 ring-coral/30 animate-pulse" : "bg-ink/30"}
        `}
      >
        {nickname.slice(0, 1)}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-ink">{nickname}</span>
          {isHost && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400 text-white font-bold">房主</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-ink/60">
          <span>已破译 {revealedCount}/{totalCount}</span>
          {active && <span className="text-coral font-bold">● 回合中</span>}
        </div>
      </div>
    </div>
  );
}

function DaVinciResult({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);
  const dvGameOver = useGameStore((s) => s.dvGameOver);
  const dvState = useGameStore((s) => s.dvState);
  const { dvRestart, leaveRoom } = useRoomActions();
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (dvGameOver?.winnerId === myId) {
      setShowConfetti(true);
    }
  }, [dvGameOver, myId]);

  if (!room || !dvGameOver) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center text-ink/60">
        结算中…
      </div>
    );
  }

  const isWinner = dvGameOver.winnerId === myId;
  const me = room.players.find((p) => p.id === myId);
  const opponent = room.players.find((p) => p.id !== myId);

  const handleRestart = () => dvRestart(roomId);
  const handleLeave = () => {
    leaveRoom(roomId);
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {showConfetti && <Confetti />}

      <div className={`text-6xl font-black mb-2 ${isWinner ? "text-mint" : "text-coral"}`}>
        {isWinner ? "胜利！" : "惜败"}
      </div>
      <div className="text-ink/60 mb-8">
        {isWinner ? "你破译了对方所有密码 🎉" : `${dvGameOver.winnerNickname} 获胜`}
      </div>

      {/* 双方手牌亮出 */}
      {dvState && (
        <div className="w-full max-w-md bg-white rounded-3xl p-5 shadow-card mb-6 space-y-4">
          <div>
            <div className="text-sm font-bold text-ink/60 mb-2">{me?.nickname}（你）</div>
            <div className="flex flex-wrap gap-1.5">
              {dvState.myHand.map((c) => (
                <MiniCard key={c.id} color={c.color} number={c.number} revealed={c.revealed} />
              ))}
            </div>
          </div>
          <div className="border-t border-ink/10 pt-4">
            <div className="text-sm font-bold text-ink/60 mb-2">{opponent?.nickname}</div>
            <div className="flex flex-wrap gap-1.5">
              {(dvState.opponentHand || []).map((c) => (
                <MiniCard key={c.id} color={c.color} number={c.number} revealed />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleLeave}
          className="flex items-center gap-2 px-6 py-3 rounded-full border-2 border-ink/20 text-ink/70 font-bold hover:bg-white active:scale-95 transition-all"
        >
          <LogOut className="w-4 h-4" /> 离开
        </button>
        {room.players.find((p) => p.id === myId)?.isHost && (
          <button
            onClick={handleRestart}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-coral text-white font-bold shadow-pop hover:brightness-110 active:scale-95 transition-all"
          >
            <RotateCcw className="w-4 h-4" /> 再来一局
          </button>
        )}
      </div>
    </div>
  );
}

function MiniCard({ color, number, revealed }: { color: DaVinciColor; number: number; revealed: boolean }) {
  const style = COLOR_STYLES[color];
  return (
    <div
      className={`${style.bg} ${style.text} ${style.border} border-2 rounded-lg w-9 h-12 flex flex-col items-center justify-center ${revealed ? "opacity-100" : "opacity-50"}`}
    >
      <span className="text-[9px] opacity-60 leading-none">{style.label}</span>
      <span className="text-base font-black leading-none mt-0.5">{number}</span>
    </div>
  );
}
