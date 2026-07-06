import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, LogIn, Sparkles, Palette, Brain, User, Heart, Lock, HelpCircle } from "lucide-react";
import { useRoomActions } from "@/hooks/useSocket";
import { useGameStore } from "@/store/gameStore";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import type { GameType } from "@/lib/types";

export default function Home() {
  const { createRoom, joinRoom } = useRoomActions();
  const { connected, error, room, setError, reset } = useGameStore();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<"home" | "join">("home");
  const [gameType, setGameType] = useState<GameType>("draw-memory");
  const pendingActionRef = useRef(false);

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  // 进入首页时重置房间状态
  useEffect(() => {
    reset();
    pendingActionRef.current = false;
  }, [reset]);

  // 监听房间状态变化，自动跳转
  useEffect(() => {
    if (room && pendingActionRef.current) {
      navigate(`/lobby/${room.roomId}`);
    }
  }, [room, navigate]);

  const handleCreate = () => {
    if (!nickname.trim()) {
      setError("请输入昵称");
      return;
    }
    pendingActionRef.current = true;
    createRoom(nickname.trim(), gameType);
  };

  const handleJoin = () => {
    if (!nickname.trim()) {
      setError("请输入昵称");
      return;
    }
    if (!roomCode.trim()) {
      setError("请输入房间码");
      return;
    }
    pendingActionRef.current = true;
    playSfx(sfx.click);
    joinRoom(roomCode.trim().toUpperCase(), nickname.trim());
  };

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative">
      {/* 背景装饰 */}
      <div className="absolute top-10 left-5 text-6xl animate-float opacity-20" style={{ animationDelay: "0s" }}>
        🎨
      </div>
      <div className="absolute top-20 right-5 text-5xl animate-float opacity-20" style={{ animationDelay: "1s" }}>
        ✏️
      </div>
      <div className="absolute bottom-20 left-8 text-5xl animate-float opacity-20" style={{ animationDelay: "2s" }}>
        🧠
      </div>
      <div className="absolute bottom-32 right-10 text-4xl animate-float opacity-20" style={{ animationDelay: "0.5s" }}>
        ⏰
      </div>

      <div className="w-full max-w-md flex flex-col items-center relative z-10">
        {/* 标题 */}
        <div className="mt-8 mb-2 text-center animate-bounce-in">
          <h1 className="font-display text-6xl text-ink leading-tight">
            画词记忆
          </h1>
          <div className="mt-1 flex items-center justify-center gap-2">
            <div className="h-1 w-16 bg-coral rounded-full" />
            <Sparkles size={20} className="text-sun" />
            <div className="h-1 w-16 bg-coral rounded-full" />
          </div>
          <p className="font-body text-ink-muted text-sm mt-3">
            看词 · 画画 · 猜词 · 双人对战
          </p>
        </div>

        {/* 状态指示 */}
        <div className="mb-6 flex items-center gap-2 text-xs">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? "bg-mint" : "bg-warn"
            } ${connected ? "" : "animate-pulse"}`}
          />
          <span className="text-ink-muted">
            {connected ? "已连接" : "连接中..."}
          </span>
        </div>

        {/* 主卡片 */}
        <div className="w-full bg-white rounded-blob shadow-card border-3 border-ink p-6 animate-slide-up">
          {/* 昵称输入 */}
          <div className="mb-4">
            <label className="font-display text-ink text-sm flex items-center gap-1.5 mb-2">
              <Pencil size={16} />
              你的昵称
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={10}
              placeholder="输入昵称"
              className="w-full px-4 py-3 rounded-doodle border-2 border-ink bg-cream font-body text-ink focus:border-coral focus:bg-white transition-colors"
            />
          </div>

          {/* 游戏选择 */}
          <div className="mb-5">
            <label className="font-display text-ink text-sm flex items-center gap-1.5 mb-2">
              <Sparkles size={16} />
              选择游戏
            </label>
            <div className="grid grid-cols-2 gap-2">
              <GameCard
                icon={<Palette size={18} />}
                emoji="🎨"
                title="画词记忆"
                desc="画画猜词"
                selected={gameType === "draw-memory"}
                onClick={() => {
                  setGameType("draw-memory");
                  playSfx(sfx.uiTick);
                }}
              />
              <GameCard
                icon={<Heart size={18} />}
                emoji="💕"
                title="默契考验"
                desc="心有灵犀"
                selected={gameType === "telepathy"}
                onClick={() => {
                  setGameType("telepathy");
                  playSfx(sfx.uiTick);
                }}
              />
              <GameCard
                icon={<HelpCircle size={18} />}
                emoji="🐢"
                title="海龟汤"
                desc="AI主持人"
                selected={gameType === "turtle-soup"}
                onClick={() => {
                  setGameType("turtle-soup");
                  playSfx(sfx.uiTick);
                }}
              />
              <GameCard
                icon={<Lock size={18} />}
                emoji="🚧"
                title="合作画画"
                desc="即将推出"
                disabled
                onClick={() => playSfx(sfx.wrong)}
              />
            </div>
          </div>

          {mode === "home" ? (
            <>
              <button
                onClick={handleCreate}
                disabled={!connected}
                className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Palette size={22} />
                创建房间
              </button>
              <button
                onClick={() => {
                  setMode("join");
                  setError(null);
                }}
                className="btn-press w-full py-3 mt-3 bg-white text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-pop flex items-center justify-center gap-2"
              >
                <LogIn size={20} />
                加入房间
              </button>
              <button
                onClick={() => navigate("/solo")}
                className="btn-press w-full py-3 mt-3 bg-mint text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-pop flex items-center justify-center gap-2"
              >
                <User size={20} />
                单人测试
              </button>
            </>
          ) : (
            <>
              <div className="mb-4">
                <label className="font-display text-ink text-sm flex items-center gap-1.5 mb-2">
                  <LogIn size={16} />
                  房间码
                </label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) =>
                    setRoomCode(e.target.value.toUpperCase().slice(0, 4))
                  }
                  placeholder="ABCD"
                  className="w-full px-4 py-3 rounded-doodle border-2 border-ink bg-cream font-display text-ink text-2xl text-center tracking-widest focus:border-coral focus:bg-white transition-colors"
                />
              </div>
              <button
                onClick={handleJoin}
                disabled={!connected}
                className="btn-press w-full py-4 bg-mint text-ink font-display text-xl rounded-doodle shadow-pop border-2 border-ink disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <LogIn size={22} />
                加入
              </button>
              <button
                onClick={() => {
                  setMode("home");
                  setError(null);
                }}
                className="btn-press w-full py-2 mt-3 text-ink-muted font-body text-sm"
              >
                ← 返回
              </button>
            </>
          )}

          {error && (
            <div className="mt-3 text-center text-coral font-body text-sm animate-shake">
              {error}
            </div>
          )}
        </div>

        {/* 玩法说明 */}
        <div className="w-full mt-6 mb-8">
          <h2 className="font-display text-ink text-lg text-center mb-3">
            怎么玩？
          </h2>
          <div className="space-y-3">
            <PlayStep
              icon={<Brain size={20} />}
              num="1"
              title="记忆词语"
              desc="看词3秒画图8秒，依次记忆30个词语"
              color="bg-coral-light"
            />
            <PlayStep
              icon={<Palette size={20} />}
              num="2"
              title="画出词语"
              desc="凭记忆为每个词作画，不能写文字！"
              color="bg-sun"
            />
            <PlayStep
              icon={<Sparkles size={20} />}
              num="3"
              title="看画猜词"
              desc="系统出题，看自己的画反推词语"
              color="bg-mint"
            />
          </div>
          <p className="text-center text-xs text-ink-muted mt-4">
            共3轮 · 每轮10题 · 总分高者胜
          </p>
        </div>
      </div>
    </div>
  );
}

function PlayStep({
  icon,
  num,
  title,
  desc,
  color,
}: {
  icon: React.ReactNode;
  num: string;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 bg-white rounded-doodle p-3 border-2 border-ink shadow-soft">
      <div
        className={`flex items-center justify-center w-10 h-10 rounded-full ${color} border-2 border-ink font-display text-ink`}
      >
        {num}
      </div>
      <div className="flex-1">
        <div className="font-display text-ink flex items-center gap-1.5">
          {icon}
          {title}
        </div>
        <div className="text-xs text-ink-muted">{desc}</div>
      </div>
    </div>
  );
}

function GameCard({
  icon,
  emoji,
  title,
  desc,
  selected,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  emoji: string;
  title: string;
  desc: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative py-3 px-1 rounded-doodle border-2 font-display transition-all flex flex-col items-center gap-0.5 ${
        disabled
          ? "bg-cream-dark text-ink-muted border-ink/20 cursor-not-allowed opacity-70"
          : selected
          ? "bg-coral text-white border-ink shadow-soft btn-press"
          : "bg-white text-ink border-ink/30 btn-press"
      }`}
    >
      <div className="text-2xl leading-none">{emoji}</div>
      <div className="text-xs flex items-center gap-0.5 mt-0.5">
        {!disabled && icon}
        {title}
      </div>
      <div className={`text-[10px] ${selected ? "text-white/80" : "text-ink-muted"}`}>
        {desc}
      </div>
      {disabled && (
        <div className="absolute -top-1.5 -right-1.5 bg-ink text-cream text-[9px] px-1.5 py-0.5 rounded-full border border-ink">
          即将推出
        </div>
      )}
    </button>
  );
}
