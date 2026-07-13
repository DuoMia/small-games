import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Copy, Check, Play, LogOut, Users } from "lucide-react";
import { useRoomActions } from "@/hooks/useSocket";
import { useGameStore } from "@/store/gameStore";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import PlayerCard from "@/components/PlayerCard";
import { DIFFICULTY_LIST, getDifficultyConfig } from "@/lib/difficulty";
// 默契考验题包数据
import telepathyPacks from "../../api/data/telepathy-questions.json";

interface TelepathyPack {
  id: string;
  name: string;
  icon: string;
  color: string;
  questions: { question: string; options: string[] }[];
}

export default function Lobby() {
  const { roomId } = useParams<{ roomId: string }>();
  const { toggleReady, startGame, leaveRoom, setWordsCount, setDifficulty, setTelepathyPack, setCoOpOrientation } =
    useRoomActions();
  const { room, myId, phase, coOpOrientation } = useGameStore();
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
  const gameType = room?.gameType ?? "draw-memory";
  const telepathyPackId = room?.telepathyPackId ?? "life";
  const isTelepathy = gameType === "telepathy";
  const isHeartAttack = gameType === "heart-attack";
  const isCoOp = gameType === "co-op-drawing";
  const isEmoji = gameType === "emoji-guessing";
  const isDaVinci = gameType === "davinci-code";

  // 当前选中的题包信息
  const currentPack = (telepathyPacks as TelepathyPack[]).find(
    (p) => p.id === telepathyPackId
  );

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

        {/* 游戏类型标识 */}
        <div className="w-full mb-4 text-center">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border-2 border-ink font-display text-sm ${
              isTelepathy ? "bg-coral-light text-ink" : isHeartAttack ? "bg-mint text-ink" : isCoOp ? "bg-sun text-ink" : isEmoji ? "bg-coral-light text-ink" : isDaVinci ? "bg-mint text-ink" : "bg-sun text-ink"
            }`}
          >
            <span>{isTelepathy ? "💕" : isHeartAttack ? "🔔" : isCoOp ? "✏️" : isEmoji ? "😎" : isDaVinci ? "🔐" : "🎨"}</span>
            {isTelepathy ? "默契考验" : isHeartAttack ? "德国心脏病" : isCoOp ? "合作画画" : isEmoji ? "表情包猜词" : isDaVinci ? "达芬奇密码" : "画词记忆"}
          </span>
        </div>

        {/* 配置区：根据游戏类型渲染不同配置 */}
        {isTelepathy ? (
          // 默契考验：题包选择
          <div className="w-full bg-white rounded-doodle border-2 border-ink p-4 mb-6 shadow-soft">
            <p className="font-display text-ink text-sm mb-2 flex items-center justify-between">
              <span>题包选择</span>
              {!isHost && <span className="text-xs text-ink-muted">房主设置</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(telepathyPacks as TelepathyPack[]).map((p) => (
                <button
                  key={p.id}
                  disabled={!isHost}
                  onClick={() => {
                    if (roomId && isHost) {
                      setTelepathyPack(roomId, p.id);
                      playSfx(sfx.uiTick);
                    }
                  }}
                  className={`py-3 rounded-doodle border-2 font-display text-sm transition-all flex flex-col items-center gap-1 ${
                    telepathyPackId === p.id
                      ? "bg-coral text-white border-ink shadow-soft"
                      : "bg-white text-ink border-ink/30"
                  } ${!isHost ? "cursor-not-allowed opacity-70" : "btn-press"}`}
                >
                  <span className="text-2xl">{p.icon}</span>
                  <span>{p.name}</span>
                  <span
                    className={`text-[10px] ${
                      telepathyPackId === p.id ? "text-white/80" : "text-ink-muted"
                    }`}
                  >
                    {p.questions.length} 题
                  </span>
                </button>
              ))}
            </div>
            <p className="text-center text-xs text-ink-muted mt-2">
              题库 {currentPack?.questions.length ?? 15} 题 · 随机抽 10 题
            </p>
          </div>
        ) : isHeartAttack ? (
          <div className="w-full bg-white rounded-doodle border-2 border-ink p-4 mb-6 shadow-soft">
            <p className="font-display text-ink text-sm mb-2 flex items-center justify-between">
              <span>难度选择</span>
              {!isHost && <span className="text-xs text-ink-muted">房主设置</span>}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(["easy", "normal", "hard"] as const).map((d) => {
                const cfg = getDifficultyConfig(d);
                return (
                  <button
                    key={d}
                    disabled={!isHost}
                    onClick={() => {
                      if (roomId && isHost) {
                        setDifficulty(roomId, d);
                        playSfx(sfx.uiTick);
                      }
                    }}
                    className={`py-2.5 rounded-doodle border-2 font-display text-sm transition-all flex flex-col items-center gap-0.5 ${
                      difficulty === d
                        ? `${cfg.color} border-ink shadow-soft`
                        : "bg-white text-ink border-ink/30"
                    } ${!isHost ? "cursor-not-allowed opacity-70" : "btn-press"}`}
                  >
                    <span>{cfg.icon}</span>
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            <p className="text-center text-xs text-ink-muted mt-2">
              {difficulty === "easy" && "1-2种水果/牌，牌面简单，适合新手"}
              {difficulty === "normal" && "2-3种水果/牌，中等难度"}
              {difficulty === "hard" && "2-4种水果/牌，拍错罚2张，挑战高手"}
            </p>
          </div>
        ) : isCoOp ? (
          // 合作画画：横屏/竖屏选择
          <div className="w-full bg-white rounded-doodle border-2 border-ink p-4 mb-6 shadow-soft">
            <p className="font-display text-ink text-sm mb-2 flex items-center justify-between">
              <span>画布方向</span>
              {!isHost && <span className="text-xs text-ink-muted">房主设置</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={!isHost}
                onClick={() => {
                  if (roomId && isHost) {
                    setCoOpOrientation(roomId, "landscape");
                    playSfx(sfx.uiTick);
                  }
                }}
                className={`py-3 rounded-doodle border-2 font-display text-sm transition-all flex flex-col items-center gap-1 ${
                  coOpOrientation === "landscape"
                    ? "bg-coral text-white border-ink shadow-soft"
                    : "bg-white text-ink border-ink/30"
                } ${!isHost ? "cursor-not-allowed opacity-70" : "btn-press"}`}
              >
                <span className="text-2xl">📱</span>
                <span>横屏画</span>
                <span className={`text-[10px] ${coOpOrientation === "landscape" ? "text-white/80" : "text-ink-muted"}`}>
                  4:3 建议横放
                </span>
              </button>
              <button
                disabled={!isHost}
                onClick={() => {
                  if (roomId && isHost) {
                    setCoOpOrientation(roomId, "portrait");
                    playSfx(sfx.uiTick);
                  }
                }}
                className={`py-3 rounded-doodle border-2 font-display text-sm transition-all flex flex-col items-center gap-1 ${
                  coOpOrientation === "portrait"
                    ? "bg-coral text-white border-ink shadow-soft"
                    : "bg-white text-ink border-ink/30"
                } ${!isHost ? "cursor-not-allowed opacity-70" : "btn-press"}`}
              >
                <span className="text-2xl">📲</span>
                <span>竖屏画</span>
                <span className={`text-[10px] ${coOpOrientation === "portrait" ? "text-white/80" : "text-ink-muted"}`}>
                  3:4 建议竖放
                </span>
              </button>
            </div>
            <p className="text-center text-xs text-ink-muted mt-2">
              系统随机出题 · 双方同时画 90 秒 · AI 评分
            </p>
          </div>
        ) : isEmoji ? (
          // 表情包猜词：无需配置，显示玩法提示
          <div className="w-full bg-white rounded-doodle border-2 border-ink p-4 mb-6 shadow-soft text-center">
            <div className="text-4xl mb-2">😎</div>
            <p className="font-display text-ink text-sm mb-1">表情包猜词</p>
            <p className="text-xs text-ink-muted">
              看emoji组合猜词语 · 双人PK · 共 10 题
            </p>
          </div>
        ) : isDaVinci ? (
          // 达芬奇密码：无需配置
          <div className="w-full bg-white rounded-doodle border-2 border-ink p-4 mb-6 shadow-soft text-center">
            <div className="text-4xl mb-2">🔐</div>
            <p className="font-display text-ink text-sm mb-1">达芬奇密码</p>
            <p className="text-xs text-ink-muted">
              24 张黑白数字牌 · 轮流摸牌猜数字 · 破译对方所有牌获胜
            </p>
          </div>
        ) : (
          <>
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
              <div className="mt-2 text-xs text-ink-muted text-center">
                词语：{diffConfig.categoryDesc}
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
          </>
        )}

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
          <p className="font-display text-ink text-sm mb-2">
            {isTelepathy ? "💕 默契考验规则" : isHeartAttack ? "🔔 德国心脏病规则" : isCoOp ? "✏️ 合作画画规则" : isEmoji ? "🎯 表情包猜词规则" : isDaVinci ? "🔐 达芬奇密码规则" : "📋 游戏规则"}
          </p>
          {isTelepathy ? (
            <ul className="text-xs text-ink-muted space-y-1">
              <li>· 共 10 题，每题 5 个选项 A/B/C/D/E</li>
              <li>· 双方同时作答，每题限时 15 秒</li>
              <li>· 不选默认 E，超时也算选择</li>
              <li>· 答案一致 +10 分；相邻 +5 分；其他 +0 分</li>
              <li>· 题包：{currentPack?.icon} {currentPack?.name ?? "生活日常"}</li>
              <li>· 最终看默契度百分比和总分</li>
            </ul>
          ) : isHeartAttack ? (
            <ul className="text-xs text-ink-muted space-y-1">
              <li>· 4 种水果（🍎🍌🍒🍋），每张牌含混合水果（1-5个）</li>
              <li>· 双方牌堆均分，轮流翻牌到桌面中央</li>
              <li>· 桌面任一水果总数恰好为 5 时，先拍铃者赢牌</li>
              <li>· 拍铃正确：赢得桌面所有牌；错误：给对手{difficulty === "hard" ? " 2" : " 1"}张牌</li>
              <li>· 双方牌堆耗尽，赢牌多者获胜</li>
            </ul>
          ) : isCoOp ? (
            <ul className="text-xs text-ink-muted space-y-1">
              <li>· 系统给一个画图命题（动物/食物/场景等）</li>
              <li>· 双方在同一画布上同时画，限时 90 秒</li>
              <li>· 两人的笔画实时同步到对方屏幕</li>
              <li>· 可随时切换颜色、粗细、橡皮擦</li>
              <li>· 时间到后 AI 对画作打分（0-10 分）并给评价</li>
              <li>· 可下载画作截图保存</li>
            </ul>
          ) : isEmoji ? (
            <ul className="text-xs text-ink-muted space-y-1">
              <li>· 看emoji组合猜词语，10题PK</li>
              <li>· 双方同时作答，每题 30 秒</li>
              <li>· 答对 +10 分，答错 +0 分</li>
              <li>· 答案不区分大小写、忽略空格</li>
              <li>· 题库覆盖成语/电影/动物/食物/网络梗等</li>
              <li>· 10 题总分高者获胜，平局也算</li>
            </ul>
          ) : isDaVinci ? (
            <ul className="text-xs text-ink-muted space-y-1">
              <li>· 24 张牌：黑/白各 12 张（数字 0-11）</li>
              <li>· 每人发 4 张，按左小右大排序立在自己面前</li>
              <li>· 回合流程：摸一张新牌 → 猜对手任意一张的数字</li>
              <li>· 猜对：该牌亮出，可继续猜或结束回合</li>
              <li>· 猜错：自己刚摸的牌倒下（亮出）插入手牌，回合结束</li>
              <li>· 先破译对方所有牌者获胜</li>
            </ul>
          ) : (
            <ul className="text-xs text-ink-muted space-y-1">
              <li>· 共3轮，每轮画 {wordsPerRound} 词 · 答 {wordsPerRound} 题</li>
              <li>· 看词 3s，画图 8s</li>
              <li>· 画中不能有文字，否则警告！</li>
              <li>· 看画猜词，答对+1分</li>
              <li>· 3轮总分高者获胜</li>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
