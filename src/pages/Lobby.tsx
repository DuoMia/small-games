import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Copy, Check, Play, LogOut, Users } from "lucide-react";
import { useRoomActions } from "@/hooks/useSocket";
import { useGameStore } from "@/store/gameStore";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import PlayerCard from "@/components/PlayerCard";
import { DIFFICULTY_LIST, getDifficultyConfig } from "@/lib/difficulty";

export default function Lobby() {
  const { roomId } = useParams<{ roomId: string }>();
  const { toggleReady, startGame, leaveRoom, setWordsCount, setDifficulty } =
    useRoomActions();
  const { room, myId, phase } = useGameStore();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const me = room?.players.find((p) => p.id === myId);
  const opponent = room?.players.find((p) => p.id !== myId);
  const isHost = me?.isHost;
  const bothReady =
    room?.players.length === 2 && room.players.every((p) => p.isReady);

  const wordsPerRound = room?.wordsPerRound ?? 30;
  const difficulty = room?.difficulty ?? "normal";
  const diffConfig = getDifficultyConfig(difficulty);

  const handleCopy = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    playSfx(sfx.click);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLeave = () => {
    if (roomId) leaveRoom(roomId);
    navigate("/");
  };

  useEffect(() => {
    if (phase && phase !== "WAITING" && room?.roomId) {
      navigate(`/game/${room.roomId}`);
    }
  }, [phase, room?.roomId, navigate]);

  if (!room) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-ink-muted mb-4">房间不存在或已关闭</p>
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

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center px-5 py-6">
      <div className="w-full max-w-md flex flex-col items-center">
        {/* 顶栏 */}
        <div className="w-full flex items-center justify-between mb-6">
          <button
            onClick={handleLeave}
            className="btn-press flex items-center gap-1 text-ink-muted font-body text-sm"
          >
            <LogOut size={18} />
            离开
          </button>
          <div className="flex items-center gap-1.5 text-ink-muted text-sm">
            <Users size={18} />
            <span>{room.players.length}/2</span>
          </div>
        </div>

        {/* 房间码 */}
        <div className="w-full bg-white rounded-blob border-3 border-ink shadow-card p-6 mb-6 text-center animate-bounce-in">
          <p className="font-body text-ink-muted text-sm mb-2">房间码</p>
          <div className="flex items-center justify-center gap-3">
            <span className="font-display text-5xl text-ink tracking-widest">
              {room.roomId}
            </span>
            <button
              onClick={handleCopy}
              className="btn-press p-2 bg-sun rounded-doodle border-2 border-ink"
            >
              {copied ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </div>
          <p className="text-xs text-ink-muted mt-3">
            {copied ? "已复制！分享给好友吧" : "点击复制，分享给好友"}
          </p>
        </div>

        {/* 玩家卡位 */}
        <div className="w-full space-y-4 mb-6">
          {me && <PlayerCard player={me} isMe />}
          {opponent ? (
            <PlayerCard player={opponent} />
          ) : (
            <div className="doodle-border p-4 flex items-center justify-center text-ink-muted font-body min-h-[80px]">
              <div className="text-center">
                <div className="text-3xl mb-1">⏳</div>
                <div className="text-sm">等待玩家加入...</div>
              </div>
            </div>
          )}
        </div>

        {/* 难度选择（房主可改，非房主只读） */}
        <div className="w-full bg-white rounded-doodle border-2 border-ink p-4 mb-3 shadow-soft">
          <p className="font-display text-ink text-sm mb-2 flex items-center justify-between">
            <span>难度选择</span>
            {!isHost && <span className="text-xs text-ink-muted">房主设置</span>}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DIFFICULTY_LIST.map((d) => (
              <button
                key={d.key}
                disabled={!isHost}
                onClick={() => {
                  if (roomId && isHost) {
                    setDifficulty(roomId, d.key);
                    playSfx(sfx.uiTick);
                  }
                }}
                className={`py-2.5 rounded-doodle border-2 font-display text-sm transition-all flex items-center justify-center gap-1.5 ${
                  difficulty === d.key
                    ? "bg-coral text-white border-ink shadow-soft"
                    : "bg-white text-ink border-ink/30"
                } ${!isHost ? "cursor-not-allowed opacity-70" : "btn-press"}`}
              >
                <span>{d.icon}</span>
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-2 text-xs text-ink-muted">
            <span>看词 {diffConfig.viewTime}s</span>
            <span>画图 {diffConfig.drawTime}s</span>
            <span>每词 {diffConfig.wordDuration}s</span>
            <span>词库 {diffConfig.categories.length === 0 ? "全部" : "筛选"}</span>
          </div>
        </div>

        {/* 题量选择（房主可改，非房主只读） */}
        <div className="w-full bg-white rounded-doodle border-2 border-ink p-4 mb-6 shadow-soft">
          <p className="font-display text-ink text-sm mb-2 flex items-center justify-between">
            <span>题量选择</span>
            {!isHost && <span className="text-xs text-ink-muted">房主设置</span>}
          </p>
          <div className="flex gap-2">
            {[15, 30].map((n) => (
              <button
                key={n}
                disabled={!isHost}
                onClick={() => {
                  if (roomId && isHost) {
                    setWordsCount(roomId, n);
                    playSfx(sfx.uiTick);
                  }
                }}
                className={`flex-1 py-3 rounded-doodle border-2 font-display text-base transition-all ${
                  wordsPerRound === n
                    ? "bg-coral text-white border-ink shadow-soft"
                    : "bg-white text-ink border-ink/30"
                } ${!isHost ? "cursor-not-allowed opacity-70" : "btn-press"}`}
              >
                {n} 题
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-ink-muted mt-2">
            画 {wordsPerRound} 个词 · 答 {wordsPerRound} 题
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="w-full space-y-3">
          {isHost ? (
            <button
              onClick={() => {
                if (roomId && bothReady) {
                  playSfx(sfx.click);
                  startGame(roomId);
                }
              }}
              disabled={!bothReady}
              className="btn-press w-full py-4 bg-coral text-white font-display text-xl rounded-doodle shadow-pop border-2 border-ink disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Play size={22} />
              {bothReady ? "开始游戏" : "等待准备"}
            </button>
          ) : (
            <button
              onClick={() => {
                playSfx(sfx.click);
                if (roomId) toggleReady(roomId);
              }}
              className={`btn-press w-full py-4 font-display text-xl rounded-doodle shadow-pop border-2 border-ink flex items-center justify-center gap-2 ${
                me?.isReady ? "bg-warn text-white" : "bg-mint text-ink"
              }`}
            >
              {me?.isReady ? "取消准备" : "准备好了"}
            </button>
          )}

          {isHost && (
            <button
              onClick={() => {
                playSfx(sfx.click);
                if (roomId) toggleReady(roomId);
              }}
              className={`btn-press w-full py-3 font-display text-lg rounded-doodle shadow-pop border-2 border-ink ${
                me?.isReady ? "bg-warn text-white" : "bg-white text-ink"
              }`}
            >
              {me?.isReady ? "取消准备" : "我准备好了"}
            </button>
          )}
        </div>

        {/* 规则提示 */}
        <div className="w-full mt-6 bg-cream-dark rounded-doodle p-4 border-2 border-ink-muted">
          <p className="font-display text-ink text-sm mb-2">📋 游戏规则</p>
          <ul className="text-xs text-ink-muted space-y-1">
            <li>· 共3轮，每轮画 {wordsPerRound} 词 · 答 {wordsPerRound} 题</li>
            <li>· 看词 {diffConfig.viewTime}s，画图 {diffConfig.drawTime}s</li>
            <li>· 画中不能有文字，否则警告！</li>
            <li>· 看画猜词，答对+1分</li>
            <li>· 3轮总分高者获胜</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
