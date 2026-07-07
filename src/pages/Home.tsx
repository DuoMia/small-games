import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, LogIn, Sparkles, Palette, User, Heart, HelpCircle, Smile, RefreshCw, ChevronDown, ChevronUp, X } from "lucide-react";
import { useRoomActions } from "@/hooks/useSocket";
import { useGameStore } from "@/store/gameStore";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import AudioSettings from "@/components/AudioSettings";
import type { GameType, RoomView } from "@/lib/types";

// 单人模式可选的游戏列表
const SOLO_GAME_OPTIONS: { gameType: GameType; emoji: string; name: string; desc: string }[] = [
  { gameType: "draw-memory", emoji: "🎨", name: "画词记忆", desc: "看词画图答题" },
  { gameType: "telepathy", emoji: "💕", name: "默契考验", desc: "模拟朋友答案" },
  { gameType: "turtle-soup", emoji: "🐢", name: "海龟汤", desc: "本地提问猜真相" },
  { gameType: "co-op-drawing", emoji: "✏️", name: "合作画画", desc: "命题作画自评" },
  { gameType: "emoji-guessing", emoji: "😎", name: "表情包猜词", desc: "看 emoji 猜词" },
];

// 20 个形容词 + 20 个名词，用于随机昵称生成
const ADJECTIVES = [
  "快乐", "机智", "慵懒", "勇敢", "调皮",
  "温柔", "活泼", "安静", "神秘", "可爱",
  "聪明", "呆萌", "霸气", "悠闲", "灵巧",
  "害羞", "洒脱", "傲娇", "迷糊", "憨厚",
];
const NOUNS = [
  "猫咪", "海豚", "树懒", "小熊", "兔子",
  "狐狸", "企鹅", "熊猫", "柴犬", "鹦鹉",
  "仓鼠", "考拉", "刺猬", "海龟", "猫头鹰",
  "松鼠", "水獭", "章鱼", "恐龙", "独角兽",
];

// 生成随机昵称：形容词 + 名词
function genRandomNickname(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return adj + noun;
}

// 游戏类型 → 名称 + emoji
const GAME_TYPE_INFO: Record<GameType, { name: string; emoji: string }> = {
  "draw-memory": { name: "画词记忆", emoji: "🎨" },
  "telepathy": { name: "默契考验", emoji: "💕" },
  "turtle-soup": { name: "海龟汤", emoji: "🐢" },
  "co-op-drawing": { name: "合作画画", emoji: "✏️" },
  "emoji-guessing": { name: "表情包猜词", emoji: "😎" },
};

// 5 个游戏的玩法简介（用于玩法说明区域）
const GAME_OVERVIEW: { emoji: string; name: string; desc: string; color: string }[] = [
  { emoji: "🎨", name: "画词记忆", desc: "看词画画猜词 · 3 轮对战", color: "bg-coral-light" },
  { emoji: "💕", name: "默契考验", desc: "同题同选 · 测默契度", color: "bg-coral-light" },
  { emoji: "🐢", name: "海龟汤", desc: "AI 主持 · 20 问还原真相", color: "bg-mint" },
  { emoji: "✏️", name: "合作画画", desc: "接龙共创 · 双人合作", color: "bg-sun" },
  { emoji: "😎", name: "表情包猜词", desc: "看 emoji 猜词 · 10 题 PK", color: "bg-coral-light" },
];

// 相对时间格式化：刚刚 / X 分钟前 / X 小时前 / X 天前
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export default function Home() {
  const { createRoom, joinRoom, listRooms } = useRoomActions();
  const { connected, error, room, setError, reset, publicRooms } = useGameStore();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  // 进入页面时自动生成一个随机昵称（用户可修改覆盖）
  const [nickname, setNickname] = useState(() => genRandomNickname());
  const [roomCode, setRoomCode] = useState("");
  // home: 主菜单；lobby: 房间列表面板
  const [mode, setMode] = useState<"home" | "lobby">("home");
  // 是否展开手动输入房间码
  const [showCodeInput, setShowCodeInput] = useState(false);
  // 是否显示单人游戏选择弹窗
  const [soloPickerOpen, setSoloPickerOpen] = useState(false);
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

  // 进入大厅模式时拉取一次房间列表
  useEffect(() => {
    if (mode === "lobby" && connected) {
      listRooms();
    }
  }, [mode, connected, listRooms]);

  const handleCreate = () => {
    if (!nickname.trim()) {
      setError("请输入昵称");
      return;
    }
    pendingActionRef.current = true;
    playSfx(sfx.click);
    createRoom(nickname.trim(), gameType);
  };

  // 从房间列表点击直接加入
  const handleJoinFromList = (targetRoom: RoomView) => {
    if (!nickname.trim()) {
      setError("请输入昵称");
      return;
    }
    pendingActionRef.current = true;
    playSfx(sfx.click);
    joinRoom(targetRoom.roomId, nickname.trim());
  };

  // 手动输入房间码加入
  const handleJoinByCode = () => {
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

  const handleRefreshRooms = () => {
    playSfx(sfx.uiTick);
    listRooms();
  };

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-8 relative">
      {/* 音频设置（仅首页显示，避免遮挡游戏元素） */}
      <AudioSettings />
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
        🐢
      </div>

      <div className="w-full max-w-md flex flex-col items-center relative z-10">
        {/* 标题 */}
        <div className="mt-8 mb-2 text-center animate-bounce-in">
          <h1 className="font-display text-6xl text-ink leading-tight">
            派对小游戏
          </h1>
          <div className="mt-1 flex items-center justify-center gap-2">
            <div className="h-1 w-16 bg-coral rounded-full" />
            <Sparkles size={20} className="text-sun" />
            <div className="h-1 w-16 bg-coral rounded-full" />
          </div>
          <p className="font-body text-ink-muted text-sm mt-3">
            5 款游戏 · 双人联机 · 手机即可玩
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
              placeholder="输入昵称（可修改）"
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
                icon={<Pencil size={18} />}
                emoji="✏️"
                title="合作画画"
                desc="接龙共创"
                selected={gameType === "co-op-drawing"}
                onClick={() => {
                  setGameType("co-op-drawing");
                  playSfx(sfx.uiTick);
                }}
              />
              {/* 第 5 个卡片跨两列，横向布局保持视觉平衡 */}
              <GameCard
                icon={<Smile size={18} />}
                emoji="😎"
                title="表情包猜词"
                desc="看 emoji 猜词"
                selected={gameType === "emoji-guessing"}
                onClick={() => {
                  setGameType("emoji-guessing");
                  playSfx(sfx.uiTick);
                }}
                wide
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
                  setMode("lobby");
                  setError(null);
                  playSfx(sfx.click);
                }}
                disabled={!connected}
                className="btn-press w-full py-3 mt-3 bg-white text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-pop flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <LogIn size={20} />
                加入房间
              </button>
              <button
                onClick={() => {
                  setSoloPickerOpen(true);
                  playSfx(sfx.click);
                }}
                className="btn-press w-full py-3 mt-3 bg-mint text-ink font-display text-lg rounded-doodle border-2 border-ink shadow-pop flex items-center justify-center gap-2"
              >
                <User size={20} />
                单人游玩
              </button>
            </>
          ) : (
            <>
              {/* 房间列表大厅 */}
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-ink text-sm flex items-center gap-1.5">
                  <LogIn size={16} />
                  公开房间
                </span>
                <button
                  onClick={handleRefreshRooms}
                  className="btn-press flex items-center gap-1 text-ink-muted font-body text-xs px-2 py-1 rounded-doodle border border-ink/20"
                >
                  <RefreshCw size={12} />
                  刷新
                </button>
              </div>

              <div className="mb-3 max-h-64 overflow-y-auto space-y-2 pr-1">
                {publicRooms.length === 0 ? (
                  <div className="text-center py-6 text-ink-muted font-body text-sm bg-cream rounded-doodle border-2 border-dashed border-ink/20">
                    <div className="text-3xl mb-1">🎲</div>
                    暂无公开房间，去创建一个吧
                  </div>
                ) : (
                  publicRooms.map((r) => {
                    const info = GAME_TYPE_INFO[r.gameType];
                    return (
                      <button
                        key={r.roomId}
                        onClick={() => handleJoinFromList(r)}
                        disabled={!connected}
                        className="btn-press w-full flex items-center gap-3 p-3 bg-cream rounded-doodle border-2 border-ink/30 hover:border-ink hover:bg-white transition-colors disabled:opacity-50"
                      >
                        <div className="text-2xl flex-shrink-0">{info.emoji}</div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="font-display text-ink text-sm flex items-center gap-1.5">
                            <span>{info.name}</span>
                            <span className="text-ink-muted text-xs">· {r.roomId}</span>
                          </div>
                          <div className="text-xs text-ink-muted">
                            {formatRelativeTime(r.createdAt)}
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-1 bg-white px-2 py-1 rounded-full border border-ink/30">
                          <span className="text-xs font-display text-ink">
                            {r.players.length}/2
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* 折叠的手动输入房间码选项 */}
              <button
                onClick={() => {
                  setShowCodeInput((v) => !v);
                  playSfx(sfx.uiTick);
                }}
                className="btn-press w-full flex items-center justify-center gap-1 py-2 text-ink-muted font-body text-xs"
              >
                {showCodeInput ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                输入房间码加入
              </button>
              {showCodeInput && (
                <div className="mt-2 animate-slide-up">
                  <input
                    type="text"
                    value={roomCode}
                    onChange={(e) =>
                      setRoomCode(e.target.value.toUpperCase().slice(0, 4))
                    }
                    placeholder="ABCD"
                    className="w-full px-4 py-3 rounded-doodle border-2 border-ink bg-cream font-display text-ink text-2xl text-center tracking-widest focus:border-coral focus:bg-white transition-colors"
                  />
                  <button
                    onClick={handleJoinByCode}
                    disabled={!connected}
                    className="btn-press w-full py-3 mt-2 bg-mint text-ink font-display text-lg rounded-doodle shadow-pop border-2 border-ink disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <LogIn size={20} />
                    加入
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  setMode("home");
                  setShowCodeInput(false);
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

        {/* 玩法说明：5 个游戏总览 */}
        <div className="w-full mt-6 mb-8">
          <h2 className="font-display text-ink text-lg text-center mb-3">
            5 款游戏怎么玩？
          </h2>
          <div className="space-y-2">
            {GAME_OVERVIEW.map((g) => (
              <div
                key={g.name}
                className="flex items-center gap-3 bg-white rounded-doodle p-3 border-2 border-ink shadow-soft"
              >
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full ${g.color} border-2 border-ink text-xl`}
                >
                  {g.emoji}
                </div>
                <div className="flex-1">
                  <div className="font-display text-ink">{g.name}</div>
                  <div className="text-xs text-ink-muted">{g.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-ink-muted mt-4">
            创建房间 · 好友加入 · 双人对战
          </p>
        </div>
      </div>

      {/* 单人游戏选择弹窗 */}
      {soloPickerOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center px-6"
          onClick={() => {
            setSoloPickerOpen(false);
            playSfx(sfx.click);
          }}
        >
          <div
            className="bg-cream rounded-blob border-3 border-ink shadow-card p-5 w-full max-w-sm animate-bounce-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <User size={18} className="text-mint" />
                <h3 className="font-display text-ink text-lg">单人游玩</h3>
              </div>
              <button
                onClick={() => {
                  setSoloPickerOpen(false);
                  playSfx(sfx.click);
                }}
                className="btn-press p-1.5 rounded-doodle border-2 border-ink bg-white text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-ink-muted mb-3">
              选择一个游戏开始单人体验（无需联网）
            </p>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {SOLO_GAME_OPTIONS.map((g) => (
                <button
                  key={g.gameType}
                  onClick={() => {
                    playSfx(sfx.click);
                    setSoloPickerOpen(false);
                    navigate(`/solo/${g.gameType}`);
                  }}
                  className="btn-press w-full flex items-center gap-3 p-3 bg-white rounded-doodle border-2 border-ink/30 hover:border-ink hover:bg-mint/10 transition-colors text-left"
                >
                  <div className="text-2xl flex-shrink-0">{g.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-ink text-sm">{g.name}</div>
                    <div className="text-xs text-ink-muted">{g.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
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
  wide,
  onClick,
}: {
  icon: React.ReactNode;
  emoji: string;
  title: string;
  desc: string;
  selected?: boolean;
  disabled?: boolean;
  wide?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative rounded-doodle border-2 font-display transition-all ${
        wide ? "col-span-2 flex items-center gap-3 py-2.5 px-3" : "flex flex-col items-center gap-0.5 py-3 px-1"
      } ${
        disabled
          ? "bg-cream-dark text-ink-muted border-ink/20 cursor-not-allowed opacity-70"
          : selected
          ? "bg-coral text-white border-ink shadow-soft btn-press"
          : "bg-white text-ink border-ink/30 btn-press"
      }`}
    >
      <div className="text-2xl leading-none flex-shrink-0">{emoji}</div>
      {wide ? (
        <div className="flex-1 text-left min-w-0">
          <div className="font-display text-sm flex items-center gap-1">
            {!disabled && icon}
            {title}
          </div>
          <div className={`text-xs ${selected ? "text-white/80" : "text-ink-muted"}`}>
            {desc}
          </div>
        </div>
      ) : (
        <>
          <div className="text-xs flex items-center gap-0.5 mt-0.5">
            {!disabled && icon}
            {title}
          </div>
          <div className={`text-[10px] ${selected ? "text-white/80" : "text-ink-muted"}`}>
            {desc}
          </div>
        </>
      )}
      {disabled && (
        <div className="absolute -top-1.5 -right-1.5 bg-ink text-cream text-[9px] px-1.5 py-0.5 rounded-full border border-ink">
          即将推出
        </div>
      )}
    </button>
  );
}
