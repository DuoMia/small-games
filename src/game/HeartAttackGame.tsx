import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCcw, LogOut, Trophy, Bell } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import Confetti from "@/components/Confetti";
import { getDifficultyConfig } from "@/lib/difficulty";
import type { HeartFruit, HeartCard } from "@/lib/types";

const FRUIT_EMOJI: Record<HeartFruit, string> = {
  apple: "🍎",
  banana: "🍌",
  cherry: "🍒",
  lemon: "🍋",
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "简单",
  normal: "中等",
  hard: "困难",
  nightmare: "噩梦",
};

export default function HeartAttackGame({ roomId }: { roomId: string }) {
  const { phase } = useGameStore();
  if (phase === "GAME_OVER") {
    return <HeartResult roomId={roomId} />;
  }
  return <HeartPlaying roomId={roomId} />;
}

// ========== 牌面渲染（独立组件，便于单人模式复用）==========
export function HeartCardView({ card, isNew = false, ownerSide }: { card: HeartCard; isNew?: boolean; ownerSide?: "me" | "opp" | null }) {
  const allFruits: HeartFruit[] = [];
  for (const fi of card.fruits) {
    for (let i = 0; i < fi.count; i++) allFruits.push(fi.fruit);
  }
  const total = allFruits.length;

  const positions = (() => {
    if (total === 1) return [{ x: "50%", y: "50%" }];
    if (total === 2) return [{ x: "25%", y: "50%" }, { x: "75%", y: "50%" }];
    if (total === 3) return [{ x: "30%", y: "25%" }, { x: "70%", y: "25%" }, { x: "50%", y: "75%" }];
    return [{ x: "28%", y: "25%" }, { x: "72%", y: "25%" }, { x: "28%", y: "75%" }, { x: "72%", y: "75%" }];
  })();

  const emojiSize = total <= 2 ? "text-3xl" : "text-2xl";

  return (
    <div
      className={`bg-white rounded-2xl border-[3px] border-ink shadow-card relative ${isNew ? "animate-[flipIn_0.4s_ease-out]" : ""} ${
        ownerSide === "me" ? "ring-2 ring-mint/60" : ownerSide === "opp" ? "ring-2 ring-coral/50" : ""
      }`}
      style={{
        width: 96,
        height: 112,
        animation: isNew ? "flipIn 0.4s ease-out" : undefined,
      }}
    >
      {allFruits.map((fruit, i) => (
        <span
          key={i}
          className={`absolute ${emojiSize} leading-none -translate-x-1/2 -translate-y-1/2 select-none`}
          style={{ left: positions[i].x, top: positions[i].y }}
        >
          {FRUIT_EMOJI[fruit]}
        </span>
      ))}
    </div>
  );
}

// 卡背（粉色图案）
export function CardBack({ count, highlight, onClick, size = "md" }: { count: number; highlight?: boolean; onClick?: () => void; size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "w-12 h-16" : size === "lg" ? "w-20 h-24" : "w-16 h-20";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`${dim} rounded-xl border-[3px] border-ink shadow-soft flex-shrink-0 relative overflow-hidden transition-all ${
        onClick ? "cursor-pointer hover:scale-105 active:scale-95 btn-press" : "cursor-default"
      } ${highlight ? "ring-4 ring-sun animate-pulse shadow-pop" : ""}`}
      style={{
        background: "linear-gradient(135deg, #FFB6C1 0%, #FF9AAE 100%)",
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center text-2xl opacity-25 select-none">🍓</div>
      {count > 0 && (
        <div className="absolute -bottom-1 -right-1 bg-ink text-white font-display text-xs rounded-full w-6 h-6 flex items-center justify-center border-2 border-white shadow">
          {count}
        </div>
      )}
    </button>
  );
}

// 玩家头像
function PlayerAvatar({ nickname, wonCount, isOnline = true, isMe, isHost, isTurn }: {
  nickname: string;
  wonCount: number;
  isOnline?: boolean;
  isMe?: boolean;
  isHost?: boolean;
  isTurn?: boolean;
}) {
  const initial = nickname ? nickname[0] : "?";
  const bg = isMe ? "bg-mint" : "bg-white";
  return (
    <div className="flex flex-col items-center gap-1 relative">
      <div className={`relative ${isTurn ? "animate-bounce" : ""}`}>
        <div className={`w-14 h-14 rounded-full ${bg} border-[3px] border-ink shadow-card flex items-center justify-center font-display text-xl text-ink`}>
          {initial}
        </div>
        {/* 在线绿点 */}
        {isOnline && (
          <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 rounded-full bg-mint border-2 border-white" />
        )}
        {/* 赢牌数徽章 */}
        {wonCount > 0 && (
          <div className="absolute -bottom-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-ink text-white font-display text-xs flex items-center justify-center border-2 border-white shadow">
            {wonCount}
          </div>
        )}
        {/* 房主标签 */}
        {isHost && (
          <div className="absolute -top-2 -left-1 bg-coral text-white font-display text-[10px] px-1.5 py-0.5 rounded-full border-2 border-white shadow">
            房主
          </div>
        )}
        {isMe && (
          <div className="absolute -top-2 -right-1 bg-sun text-ink font-display text-[10px] px-1.5 py-0.5 rounded-full border-2 border-white shadow">
            我
          </div>
        )}
      </div>
      <span className="font-display text-xs text-ink max-w-[64px] truncate">{nickname}</span>
    </div>
  );
}

// ============ 游戏中 ============
function HeartPlaying({ roomId }: { roomId: string }) {
  const { heartState, heartResult, myId, room } = useGameStore();
  const { heartFlip, heartRing, leaveRoom } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const [resultFlash, setResultFlash] = useState<{ type: "correct" | "wrong"; ringerNickname: string; isMine: boolean; penaltyCards?: number } | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  // 翻牌动画：追踪刚翻出的牌索引
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!heartResult) return;
    const isMine = heartResult.ringerId === myId;
    setResultFlash({ type: heartResult.type, ringerNickname: heartResult.ringerNickname, isMine, penaltyCards: heartResult.penaltyCards });
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setResultFlash(null);
      flashTimerRef.current = null;
    }, 1800);
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, [heartResult, myId]);

  // 追踪新翻出的牌
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (!heartState) return;
    const cur = heartState.tableCards.length;
    if (cur > prevCountRef.current) {
      const newIds = new Set<string>();
      // 最后一张是新翻的
      const last = heartState.tableCards[heartState.tableCards.length - 1];
      if (last) newIds.add(`${last.owner}-${cur - 1}`);
      setNewCardIds(newIds);
      const t = window.setTimeout(() => setNewCardIds(new Set()), 500);
      return () => window.clearTimeout(t);
    }
    prevCountRef.current = cur;
  }, [heartState]);

  // 自动翻牌：轮到我时 3 秒后自动翻一张
  const autoFlipTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (autoFlipTimerRef.current) {
      window.clearTimeout(autoFlipTimerRef.current);
      autoFlipTimerRef.current = null;
    }
    if (!heartState) return;
    // 轮到我时自动翻牌；即使我的牌堆空了也要调用 flip，
    // 让后端切换回合或触发游戏结束
    if (heartState.myTurn) {
      autoFlipTimerRef.current = window.setTimeout(() => {
        playSfx(sfx.click);
        heartFlip(roomId);
      }, 3000);
    }
    return () => {
      if (autoFlipTimerRef.current) {
        window.clearTimeout(autoFlipTimerRef.current);
        autoFlipTimerRef.current = null;
      }
    };
  }, [heartState?.myTurn, heartState?.myDeckCount, roomId, playSfx, heartFlip]);

  if (!heartState) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-coral border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-ink-muted font-display text-sm">洗牌发牌中...</p>
        </div>
      </div>
    );
  }

  const me = room?.players.find((p) => p.id === myId);
  const opp = room?.players.find((p) => p.id !== myId);
  const myNickname = me?.nickname || "我";
  const oppNickname = opp?.nickname || "对手";
  const isHost = room?.hostId === myId;
  const diffCfg = getDifficultyConfig(heartState.difficulty as any);
  const diffLabel = DIFFICULTY_LABEL[heartState.difficulty] || "中等";

  const canRing = heartState.canRing;
  const canFlip = heartState.myTurn && heartState.myDeckCount > 0;

  const handleFlip = () => {
    if (!canFlip) return;
    playSfx(sfx.click);
    heartFlip(roomId);
  };

  const handleRing = () => {
    playSfx(sfx.click);
    heartRing(roomId);
  };

  const handleLeave = () => {
    playSfx(sfx.click);
    leaveRoom(roomId);
    navigate("/");
  };

  // 分离我的牌和对手的牌（按翻出顺序）
  const myCards = heartState.tableCards.filter((tc) => tc.owner === myId);
  const oppCards = heartState.tableCards.filter((tc) => tc.owner !== myId);

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
        @keyframes ringFlash {
          0% { background: #fff; }
          30% { background: #FFD700; }
          100% { background: #fff; }
        }
      `}</style>

      {/* 顶部栏 */}
      <div className="flex-shrink-0 px-3 py-2 flex items-center justify-between bg-white/60 border-b-2 border-ink/10">
        <button onClick={handleLeave} className="btn-press bg-white border-2 border-ink rounded-full px-3 py-1 font-display text-xs flex items-center gap-1 shadow-soft">
          <LogOut size={14} />
          退出
        </button>
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5">
            <span className="text-lg">🔔</span>
            <span className="font-display text-ink text-sm font-bold">德国心脏病</span>
            <span className={`font-display text-[10px] px-1.5 py-0.5 rounded-full border border-ink ${diffCfg.color}`}>
              {diffLabel}
            </span>
          </div>
          <span className="text-[10px] text-ink-muted font-mono">房间 {roomId}</span>
        </div>
        <div className="font-display text-[10px] text-ink-muted bg-white rounded-full px-2 py-1 border border-ink/20">
          已翻 {heartState.totalFlipped}
        </div>
      </div>

      {/* 主区域 */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* 对手栏 - pt-3 给头像跳跃留出空间 */}
        <div className="flex-shrink-0 px-3 pt-3 pb-1 flex items-center justify-between">
          <PlayerAvatar
            nickname={oppNickname}
            wonCount={heartState.opponentWonCount}
            isOnline={opp?.online ?? true}
            isHost={room?.hostId === opp?.id}
            isTurn={heartState.opponentTurn}
          />
          <div className="flex items-center gap-2">
            <span className="font-display text-xs text-ink-muted">{heartState.opponentDeckCount}</span>
            <CardBack count={heartState.opponentDeckCount} size="md" highlight={heartState.opponentTurn} />
          </div>
        </div>

        {/* 桌面牌区 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          <div className="w-full h-full flex flex-wrap gap-2 justify-center content-start">
            {heartState.tableCards.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center text-ink-muted font-display text-sm">
                  <Bell size={32} className="mx-auto mb-2 opacity-30" />
                  <p>等待翻牌...</p>
                  <p className="text-[10px] mt-1">某水果凑齐 5 个时赶紧拍铃！</p>
                </div>
              </div>
            ) : (
              heartState.tableCards.map((tc, idx) => (
                <div key={idx} className="flex flex-col items-center gap-0.5">
                  <HeartCardView
                    card={tc.card}
                    isNew={newCardIds.has(`${tc.owner}-${idx}`)}
                    ownerSide={tc.owner === myId ? "me" : "opp"}
                  />
                  <span className={`text-[9px] font-display ${tc.owner === myId ? "text-mint" : "text-coral"}`}>
                    {tc.owner === myId ? myNickname : oppNickname}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 我的栏 */}
        <div className="flex-shrink-0 px-3 py-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardBack count={heartState.myDeckCount} size="md" highlight={canFlip} onClick={canFlip ? handleFlip : undefined} />
            <span className="font-display text-xs text-ink-muted">{heartState.myDeckCount}</span>
          </div>
          <PlayerAvatar
            nickname={myNickname}
            wonCount={heartState.myWonCount}
            isMe
            isHost={isHost}
            isTurn={heartState.myTurn}
          />
        </div>
      </div>

      {/* 结果提示 */}
      {resultFlash && (
        <div className="flex-shrink-0 px-4 pb-1 animate-bounce-in">
          <div
            className={`rounded-2xl border-[3px] border-ink px-4 py-2 text-center font-display text-sm shadow-pop ${
              resultFlash.type === "correct"
                ? "bg-mint text-ink"
                : "bg-coral text-white"
            }`}
            style={{ animation: "ringFlash 0.6s ease-out" }}
          >
            {resultFlash.type === "correct" ? (
              <>🔔 {resultFlash.isMine ? "你" : resultFlash.ringerNickname} 拍铃正确，赢得桌面所有牌！</>
            ) : (
              <>❌ {resultFlash.isMine ? "你" : resultFlash.ringerNickname} 拍错了，给对手 {resultFlash.penaltyCards ?? 1} 张牌</>
            )}
          </div>
        </div>
      )}

      {/* 底部拍铃区 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink/10 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="text-center text-[11px] text-ink-muted mb-2 font-body">
          {canRing ? "🔔 水果凑齐 5 个！快拍！" : canFlip ? "⏰ 3 秒后自动翻你的牌" : heartState.opponentTurn ? "⏰ 3 秒后自动翻对手的牌" : heartState.myDeckCount === 0 ? "牌堆空了" : "等待..."}
        </div>
        <button
          onClick={handleRing}
          disabled={heartState.tableCards.length === 0}
          className={`btn-press w-full h-16 rounded-full border-[3px] border-ink font-display text-xl flex items-center justify-center gap-2 shadow-pop transition-all ${
            canRing
              ? "bg-gradient-to-b from-yellow-300 to-yellow-500 text-ink animate-pulse"
              : "bg-gradient-to-b from-yellow-200 to-yellow-400 text-ink/80"
          } disabled:opacity-50`}
          style={canRing ? { animation: "shakeBell 0.5s infinite, ringFlash 1s infinite" } : undefined}
        >
          <Bell size={28} />
          拍铃
        </button>
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
        <div className="w-10 h-10 border-4 border-coral border-t-transparent rounded-full animate-spin" />
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
      {won && <Confetti />}
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-6 animate-bounce-in">
          <div className="text-6xl mb-2">{won ? "🏆" : isDraw ? "🤝" : "😅"}</div>
          <h1 className={`font-display text-4xl ${won ? "text-mint" : isDraw ? "text-sun" : "text-coral"}`}>
            {won ? "你赢了！" : isDraw ? "平局！" : "你输了"}
          </h1>
          <p className="text-ink-muted mt-2 text-sm font-display">
            {won ? "眼疾手快！" : isDraw ? "势均力敌" : "再来一局"}
          </p>
        </div>

        <div className="bg-white rounded-2xl border-[3px] border-ink shadow-card p-5 mb-6">
          <div className="flex items-center gap-1.5 mb-3 justify-center">
            <Trophy size={18} className="text-sun" />
            <h2 className="font-display text-ink text-base">最终赢牌数</h2>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-[10px] text-ink-muted mb-1 font-display">我</div>
              <div className="font-display text-4xl text-mint">{heartGameOver.myWon}</div>
            </div>
            <div className="font-display text-3xl text-ink-muted px-3">VS</div>
            <div className="text-center flex-1">
              <div className="text-[10px] text-ink-muted mb-1 font-display">对手</div>
              <div className="font-display text-4xl text-coral">{heartGameOver.opponentWon}</div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {isHost ? (
            <button
              onClick={handleRestart}
              className="btn-press w-full py-4 bg-gradient-to-b from-yellow-300 to-yellow-500 text-ink font-display text-xl rounded-2xl shadow-pop border-[3px] border-ink flex items-center justify-center gap-2"
            >
              <RotateCcw size={22} />
              再玩一局
            </button>
          ) : (
            <div className="text-center py-2 text-ink-muted text-sm font-display">等待房主开始下一局...</div>
          )}
          <button
            onClick={handleLeave}
            className="btn-press w-full py-3 bg-white text-ink font-display text-lg rounded-2xl border-[3px] border-ink shadow-soft flex items-center justify-center gap-2"
          >
            <LogOut size={20} />
            退出房间
          </button>
        </div>
      </div>
    </div>
  );
}
