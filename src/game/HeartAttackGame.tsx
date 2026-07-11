import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, RotateCcw, LogOut, Trophy, Bell } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import Confetti from "@/components/Confetti";
import type { HeartFruit, HeartTableCard } from "@/lib/types";

// 水果 emoji 映射
const FRUIT_EMOJI: Record<HeartFruit, string> = {
  apple: "🍎",
  banana: "🍌",
  cherry: "🍒",
  lemon: "🍋",
};

// 水果中文名
const FRUIT_NAME: Record<HeartFruit, string> = {
  apple: "苹果",
  banana: "香蕉",
  cherry: "樱桃",
  lemon: "柠檬",
};

export default function HeartAttackGame({ roomId }: { roomId: string }) {
  const { phase } = useGameStore();

  // 根据阶段分发
  if (phase === "GAME_OVER") {
    return <HeartResult roomId={roomId} />;
  }
  // DRAWING = 游戏中
  return <HeartPlaying roomId={roomId} />;
}

// ============ 游戏中 ============
function HeartPlaying({ roomId }: { roomId: string }) {
  const {
    heartState,
    heartResult,
    myId,
    room,
  } = useGameStore();
  const { heartFlip, heartRing } = useRoomActions();
  const { sfxEnabled } = useAudioStore();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  // 拍铃结果提示（短暂显示后消失）
  const [resultFlash, setResultFlash] = useState<{ type: "correct" | "wrong"; ringerNickname: string; isMine: boolean } | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!heartResult) return;
    const isMine = heartResult.ringerId === myId;
    setResultFlash({ type: heartResult.type, ringerNickname: heartResult.ringerNickname, isMine });
    // 1.5 秒后清除提示
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setResultFlash(null);
      flashTimerRef.current = null;
    }, 1500);
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, [heartResult, myId]);

  if (!heartState) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin text-coral mx-auto mb-3" />
          <p className="text-ink-muted">洗牌发牌中...</p>
        </div>
      </div>
    );
  }

  const myNickname =
    room?.players.find((p) => p.id === myId)?.nickname || "我";
  const opponentNickname =
    room?.players.find((p) => p.id !== myId)?.nickname || "对手";

  // 桌面水果总数统计
  const fruitSums: Record<HeartFruit, number> = { apple: 0, banana: 0, cherry: 0, lemon: 0 };
  heartState.tableCards.forEach((tc) => {
    fruitSums[tc.card.fruit] += tc.card.count;
  });

  const canRing = heartState.canRing;
  const canFlip = !heartState.myFlipped && heartState.myDeckCount > 0;

  const handleFlip = () => {
    if (!canFlip) return;
    playSfx(sfx.click);
    heartFlip(roomId);
  };

  const handleRing = () => {
    playSfx(sfx.click);
    heartRing(roomId);
  };

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏：双方牌数 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-base">🔔</span>
          <span className="font-display text-ink text-sm">德国心脏病</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 我赢到的牌 */}
          <span className="font-display text-xs bg-mint text-ink px-2 py-1 rounded-full border-2 border-ink">
            我 {heartState.myWonCount}
          </span>
          {/* 对手赢到的牌 */}
          <span className="font-display text-xs bg-coral-light text-ink px-2 py-1 rounded-full border-2 border-ink">
            {opponentNickname} {heartState.opponentWonCount}
          </span>
        </div>
      </div>

      {/* 牌堆信息（我 / 对手） */}
      <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between border-b-2 border-ink-muted/10 bg-cream/40">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-ink-muted font-display">我的牌堆</span>
          <span className="font-display text-xs text-ink bg-white border-2 border-ink rounded-full px-2 py-0.5">
            {heartState.myDeckCount}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-display text-xs text-ink bg-white border-2 border-ink rounded-full px-2 py-0.5">
            {heartState.opponentDeckCount}
          </span>
          <span className="text-[10px] text-ink-muted font-display">对手牌堆</span>
        </div>
      </div>

      {/* 桌面区域：水果总数 + 桌面牌 */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* 水果总数统计 */}
        <div className="flex-shrink-0 grid grid-cols-4 gap-2 px-3 py-3">
          {(Object.keys(FRUIT_EMOJI) as HeartFruit[]).map((fruit) => {
            const sum = fruitSums[fruit];
            const isTarget = sum === 5;
            return (
              <div
                key={fruit}
                className={`rounded-doodle border-2 p-2 flex flex-col items-center justify-center transition-all ${
                  isTarget
                    ? "bg-sun border-ink shadow-pop animate-bounce-in"
                    : "bg-white/70 border-ink/30"
                }`}
              >
                <div className="text-2xl leading-none">{FRUIT_EMOJI[fruit]}</div>
                <div
                  className={`font-display text-lg mt-1 ${
                    isTarget ? "text-coral animate-pulse" : "text-ink"
                  }`}
                >
                  {sum}
                </div>
                <div className="text-[9px] text-ink-muted">/5</div>
              </div>
            );
          })}
        </div>

        {/* 桌面上的牌（横向滚动） */}
        <div className="flex-1 overflow-y-auto px-3 pb-2 min-h-0">
          <div className="text-[10px] text-ink-muted font-display mb-1.5 flex items-center gap-1">
            <span>桌面牌（{heartState.tableCards.length}）</span>
          </div>
          {heartState.tableCards.length === 0 ? (
            <div className="text-center py-6 text-ink-muted text-xs italic">
              还没有翻开的牌，点击下方"翻牌"开始
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {heartState.tableCards.map((tc, idx) => (
                <TableCardItem key={idx} tableCard={tc} isMine={tc.owner === myId} myNickname={myNickname} opponentNickname={opponentNickname} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 拍铃结果提示 */}
      {resultFlash && (
        <div className="flex-shrink-0 px-4 py-2 animate-bounce-in">
          <div
            className={`rounded-doodle border-2 border-ink px-3 py-2 text-center font-display text-sm ${
              resultFlash.type === "correct"
                ? "bg-mint text-ink"
                : "bg-coral text-white"
            }`}
          >
            {resultFlash.type === "correct" ? "✓ " : "✗ "}
            {resultFlash.isMine ? "你" : resultFlash.ringerNickname}
            {resultFlash.type === "correct" ? " 拍铃正确，赢得桌面所有牌！" : " 拍铃错误，给对手 1 张牌！"}
          </div>
        </div>
      )}

      {/* 底部操作区 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-3 py-3">
        <div className="flex items-center gap-2">
          {/* 翻牌按钮 */}
          <button
            onClick={handleFlip}
            disabled={!canFlip}
            className="btn-press flex-1 py-3 bg-sun text-ink font-display text-sm rounded-doodle border-2 border-ink shadow-soft disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {heartState.myFlipped ? "已翻牌" : "翻牌"}
          </button>
          {/* 拍铃按钮（大） */}
          <button
            onClick={handleRing}
            className={`btn-press flex-shrink-0 w-24 h-14 rounded-doodle border-2 border-ink font-display text-base flex items-center justify-center gap-1.5 transition-all ${
              canRing
                ? "bg-coral text-white shadow-pop animate-pulse"
                : "bg-coral text-white shadow-soft"
            }`}
          >
            <Bell size={20} />
            拍铃
          </button>
        </div>
        {/* 提示 */}
        <div className="text-center text-[10px] text-ink-muted mt-1.5">
          {canRing ? "桌上有水果凑齐 5 个！快拍铃！" : "桌面任一水果总数 = 5 时可拍铃"}
        </div>
      </div>
    </div>
  );
}

// ============ 桌面单张牌 ============
function TableCardItem({
  tableCard,
  isMine,
  myNickname,
  opponentNickname,
}: {
  tableCard: HeartTableCard;
  isMine: boolean;
  myNickname: string;
  opponentNickname: string;
}) {
  const { card } = tableCard;
  return (
    <div
      className={`rounded-doodle border-2 p-2 flex flex-col items-center animate-bounce-in ${
        isMine ? "bg-mint/30 border-ink" : "bg-coral-light border-ink"
      }`}
    >
      <div className="text-[9px] text-ink-muted mb-0.5">
        {isMine ? myNickname : opponentNickname}
      </div>
      {/* 水果网格（按 count 显示） */}
      <div className="grid grid-cols-3 gap-0.5 mb-1">
        {Array.from({ length: card.count }).map((_, i) => (
          <span key={i} className="text-base leading-none">
            {FRUIT_EMOJI[card.fruit]}
          </span>
        ))}
      </div>
      <div className="text-[10px] font-display text-ink">
        {FRUIT_NAME[card.fruit]} ×{card.count}
      </div>
    </div>
  );
}

// ============ 结果页（GAME_OVER） ============
function HeartResult({ roomId }: { roomId: string }) {
  const { heartGameOver, room, myId } = useGameStore();
  const { heartRestart, leaveRoom } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  if (!heartGameOver) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-coral" />
      </div>
    );
  }

  const isHost = room?.hostId === myId;
  const won = heartGameOver.winnerId === myId;
  const isDraw = heartGameOver.winnerId === null;

  const handleLeave = () => {
    playSfx(sfx.click);
    leaveRoom(roomId);
    navigate("/");
  };

  const handleRestart = () => {
    playSfx(sfx.click);
    heartRestart(roomId);
  };

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8 relative">
      {/* 胜利彩屑 */}
      {won && <Confetti />}

      <div className="w-full max-w-md relative z-10">
        {/* 胜负展示 */}
        <div className="text-center mb-6 animate-bounce-in">
          <div className="text-6xl mb-2 animate-float">
            {won ? "🎉" : isDraw ? "🤝" : "😅"}
          </div>
          <h1
            className={`font-display text-4xl ${
              won ? "text-mint" : isDraw ? "text-sun" : "text-coral"
            }`}
          >
            {won ? "你赢了！" : isDraw ? "平局！" : "你输了"}
          </h1>
          <p className="text-ink-muted mt-2 text-sm">
            {won ? "眼疾手快，赢得所有牌" : isDraw ? "双方牌数相同" : "下次再战"}
          </p>
        </div>

        {/* 牌数对比 */}
        <div className="bg-white rounded-doodle border-2 border-ink shadow-card p-5 mb-6">
          <div className="flex items-center gap-1.5 mb-3">
            <Trophy size={16} className="text-sun" />
            <h2 className="font-display text-ink text-sm">最终牌数</h2>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-[10px] text-ink-muted mb-1">我</div>
              <div className="font-display text-3xl text-mint">{heartGameOver.myWon}</div>
            </div>
            <div className="font-display text-2xl text-ink-muted px-3">VS</div>
            <div className="text-center flex-1">
              <div className="text-[10px] text-ink-muted mb-1">对手</div>
              <div className="font-display text-3xl text-coral">{heartGameOver.opponentWon}</div>
            </div>
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
