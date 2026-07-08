import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  RotateCcw,
  LogOut,
  Send,
  Sparkles,
  KeyRound,
  Trophy,
  Clock,
  MessageCircle,
} from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";
import Confetti from "@/components/Confetti";

// 难度显示映射
const DIFFICULTY_LABEL: Record<string, string> = {
  any: "任意",
  simple: "简单",
  medium: "中等",
  hard: "困难",
};

export default function MysteryGame({ roomId }: { roomId: string }) {
  const { phase } = useGameStore();

  // 根据阶段分发
  if (phase === "GAME_OVER") {
    return <MysteryResult roomId={roomId} />;
  }
  // DRAWING = 解密中
  return <MysteryPlaying roomId={roomId} />;
}

// ============ 解密中 ============
function MysteryPlaying({ roomId }: { roomId: string }) {
  const {
    mysteryCase,
    mysteryChat,
    mysteryGuesses,
    mysteryAttemptsLeft,
    mysteryTimeLeft,
    mysteryJudging,
    mysteryReveal,
    myId,
    room,
  } = useGameStore();
  const { mysteryChat: sendChat, mysterySubmit } = useRoomActions();
  const { sfxEnabled } = useAudioStore();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const [chatText, setChatText] = useState("");
  const [answerModalOpen, setAnswerModalOpen] = useState(false);
  const [answerText, setAnswerText] = useState("");

  const chatRef = useRef<HTMLDivElement | null>(null);

  // 新消息到达时，滚动到底部
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [mysteryChat.length, mysteryGuesses.length, mysteryJudging]);

  // 已揭晓则不可再操作
  const revealed = Boolean(mysteryReveal);
  const canInteract = !revealed && (mysteryAttemptsLeft ?? 0) > 0 && !mysteryJudging;

  const myNickname =
    room?.players.find((p) => p.id === myId)?.nickname || "我";

  const handleSendChat = () => {
    const t = chatText.trim();
    if (!t || revealed) return;
    playSfx(sfx.click);
    sendChat(roomId, t);
    setChatText("");
  };

  const handleOpenAnswer = () => {
    if (revealed) return;
    playSfx(sfx.click);
    setAnswerText("");
    setAnswerModalOpen(true);
  };

  const handleSubmitAnswer = () => {
    const g = answerText.trim();
    if (!g || revealed || mysteryJudging) return;
    playSfx(sfx.click);
    mysterySubmit(roomId, g);
    setAnswerModalOpen(false);
    setAnswerText("");
  };

  if (!mysteryCase) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin text-coral mx-auto mb-3" />
          <p className="text-ink-muted">AI 出题中...</p>
        </div>
      </div>
    );
  }

  // 倒计时格式化 mm:ss
  const mins = Math.floor((mysteryTimeLeft ?? 0) / 60);
  const secs = (mysteryTimeLeft ?? 0) % 60;
  const timeStr = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  const timeUrgent = (mysteryTimeLeft ?? 0) <= 30;

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-base">🔐</span>
          <span className="font-display text-ink text-sm">双人解密</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 倒计时 */}
          <span
            className={`font-display text-xs px-2 py-1 rounded-full border-2 border-ink flex items-center gap-1 ${
              timeUrgent ? "bg-coral text-white animate-pulse" : "bg-sun text-ink"
            }`}
          >
            <Clock size={12} />
            {timeStr}
          </span>
          {/* 难度 */}
          <span className="font-display text-xs bg-mint text-ink px-2 py-1 rounded-full border-2 border-ink">
            {DIFFICULTY_LABEL[mysteryCase.difficulty] || mysteryCase.difficulty}
          </span>
          {/* 剩余次数 */}
          <span
            className={`font-display text-xs px-2 py-1 rounded-full border-2 border-ink ${
              (mysteryAttemptsLeft ?? 0) <= 1 ? "bg-coral text-white" : "bg-white text-ink"
            }`}
          >
            剩 {mysteryAttemptsLeft} 次
          </span>
        </div>
      </div>

      {/* 故事 + 线索 + 聊天历史（可滚动） */}
      <div ref={chatRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {/* 故事背景 */}
        <div className="bg-white rounded-doodle border-2 border-ink shadow-card p-3.5 mb-3 animate-bounce-in">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={14} className="text-coral" />
            <span className="font-display text-ink text-xs">{mysteryCase.title}</span>
            {mysteryCase.category && (
              <span className="ml-auto text-[10px] text-ink-muted bg-cream-dark px-2 py-0.5 rounded-full">
                {mysteryCase.category}
              </span>
            )}
          </div>
          <p className="font-body text-ink text-sm leading-relaxed">
            {mysteryCase.story}
          </p>
        </div>

        {/* 我的线索 */}
        <div className="bg-sun/20 rounded-doodle border-2 border-ink/40 p-3 mb-3 animate-slide-up">
          <div className="flex items-center gap-1.5 mb-2">
            <KeyRound size={14} className="text-ink" />
            <span className="font-display text-ink text-xs">我看到的线索</span>
          </div>
          <ul className="space-y-1.5">
            {mysteryCase.clues.map((clue, idx) => (
              <li
                key={idx}
                className="font-body text-ink text-sm leading-relaxed flex items-start gap-1.5"
              >
                <span className="text-coral flex-shrink-0 mt-0.5">·</span>
                <span>{clue}</span>
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-ink-muted mt-2 italic">
            对方看到的是不同的线索，通过聊天交流拼凑真相
          </div>
        </div>

        {/* 聊天记录 */}
        {mysteryChat.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-1.5 px-1">
              <MessageCircle size={12} className="text-ink-muted" />
              <span className="text-[10px] text-ink-muted font-display">聊天记录</span>
            </div>
            {mysteryChat.map((msg, idx) => (
              <ChatItem key={`c-${idx}`} record={msg} isMine={msg.sender === myNickname} />
            ))}
          </div>
        )}

        {/* 答题记录 */}
        {mysteryGuesses.length > 0 && (
          <div className="space-y-2 mb-3">
            {mysteryGuesses.map((g, idx) => (
              <GuessItem key={`g-${idx}`} record={g} />
            ))}
          </div>
        )}

        {/* AI 判断中提示 */}
        {mysteryJudging && (
          <div className="flex items-center justify-center gap-2 py-3 animate-bounce-in">
            <Loader2 size={18} className="animate-spin text-coral" />
            <span className="font-body text-sm text-ink-muted">AI 裁判判断中...</span>
          </div>
        )}
      </div>

      {/* 底部输入区 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendChat();
              }
            }}
            maxLength={200}
            disabled={revealed}
            placeholder={revealed ? "已揭晓" : "和队友交流... (回车发送)"}
            className="flex-1 px-3 py-2.5 rounded-doodle border-2 border-ink bg-cream font-body text-ink text-sm focus:border-coral focus:bg-white transition-colors disabled:opacity-50"
          />
          {/* 发送聊天 */}
          <button
            onClick={handleSendChat}
            disabled={revealed || !chatText.trim()}
            className="btn-press flex-shrink-0 w-11 h-11 rounded-doodle border-2 border-ink bg-sun text-ink flex items-center justify-center disabled:opacity-40"
            title="发送消息"
          >
            <Send size={18} />
          </button>
        </div>
        {/* 提交答案按钮 */}
        <button
          onClick={handleOpenAnswer}
          disabled={revealed || mysteryJudging}
          className="btn-press w-full mt-2 py-2.5 bg-ink text-cream font-display text-sm rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          <Sparkles size={16} />
          提交答案
        </button>
      </div>

      {/* 提交答案弹窗 */}
      {answerModalOpen && (
        <AnswerModal
          value={answerText}
          onChange={setAnswerText}
          onClose={() => setAnswerModalOpen(false)}
          onSubmit={handleSubmitAnswer}
          disabled={mysteryJudging}
          attemptsLeft={mysteryAttemptsLeft ?? 0}
        />
      )}
    </div>
  );
}

// ============ 单条聊天 ============
function ChatItem({
  record,
  isMine,
}: {
  record: { sender: string; text: string; ts: number };
  isMine: boolean;
}) {
  return (
    <div
      className={`flex ${isMine ? "justify-end" : "justify-start"} animate-slide-up`}
    >
      <div
        className={`max-w-[85%] rounded-doodle border-2 p-2.5 ${
          isMine
            ? "bg-coral text-white border-ink"
            : "bg-white text-ink border-ink/30"
        }`}
      >
        {!isMine && (
          <div className="text-[10px] text-ink-muted mb-0.5 font-display">
            {record.sender}
          </div>
        )}
        <div className="font-body text-sm break-words">{record.text}</div>
      </div>
    </div>
  );
}

// ============ 单条答题记录 ============
function GuessItem({
  record,
}: {
  record: { guess: string; guesser: string; correct: boolean; close: boolean; feedback: string };
}) {
  const resultStyle = record.correct
    ? "border-mint bg-mint/10"
    : record.close
    ? "border-sun bg-sun/10"
    : "border-coral/50 bg-coral/5";
  const resultText = record.correct
    ? "答对！"
    : record.close
    ? "接近了"
    : "不对";
  const resultColor = record.correct
    ? "text-mint"
    : record.close
    ? "text-sun"
    : "text-coral";
  return (
    <div className={`rounded-doodle border-2 p-2.5 animate-slide-up ${resultStyle}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-ink-muted mb-0.5">
            <span className="font-display">{record.guesser}</span> 提交：
          </div>
          <div className="font-body text-ink text-sm break-words">{record.guess}</div>
          {record.feedback && (
            <div className="text-[11px] text-ink-muted mt-1 italic">
              AI：{record.feedback}
            </div>
          )}
        </div>
        <span className={`flex-shrink-0 font-display text-xs ${resultColor}`}>
          {resultText}
        </span>
      </div>
    </div>
  );
}

// ============ 提交答案弹窗 ============
function AnswerModal({
  value,
  onChange,
  onClose,
  onSubmit,
  disabled,
  attemptsLeft,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  disabled?: boolean;
  attemptsLeft: number;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center px-6"
      onClick={onClose}
    >
      <div
        className="bg-cream rounded-doodle border-2 border-ink shadow-card p-5 w-full max-w-sm animate-bounce-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-coral" />
          <h3 className="font-display text-ink text-lg">提交答案</h3>
        </div>
        <p className="text-xs text-ink-muted mb-3">
          和队友讨论后输入最终答案，AI 裁判会判断是否正确（剩余 {attemptsLeft} 次机会）
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          rows={3}
          maxLength={200}
          placeholder="你们推理出的答案是什么？"
          className="w-full px-3 py-2 rounded-doodle border-2 border-ink bg-white font-body text-ink text-sm focus:border-coral transition-colors resize-none"
        />
        <div className="flex gap-2 mt-3">
          <button
            onClick={onClose}
            className="btn-press flex-1 py-2.5 bg-white text-ink font-display text-sm rounded-doodle border-2 border-ink shadow-soft"
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={!value.trim() || disabled}
            className="btn-press flex-1 py-2.5 bg-coral text-white font-display text-sm rounded-doodle border-2 border-ink shadow-soft disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {disabled ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                判断中
              </>
            ) : (
              <>
                <Send size={16} />
                提交
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ 结果页（GAME_OVER） ============
function MysteryResult({ roomId }: { roomId: string }) {
  const { mysteryReveal, room, myId } = useGameStore();
  const { mysteryRestart, leaveRoom } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  if (!mysteryReveal) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-coral" />
      </div>
    );
  }

  const isHost = room?.hostId === myId;
  const won = mysteryReveal.won;

  const handleLeave = () => {
    playSfx(sfx.click);
    leaveRoom(roomId);
    navigate("/");
  };

  const handleRestart = () => {
    playSfx(sfx.click);
    mysteryRestart(roomId);
  };

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8 relative">
      {/* 胜利彩屑 */}
      {won && <Confetti />}

      <div className="w-full max-w-md relative z-10">
        {/* 胜负展示 */}
        <div className="text-center mb-6 animate-bounce-in">
          <div className="text-6xl mb-2 animate-float">
            {won ? "🎉" : "😇"}
          </div>
          <h1
            className={`font-display text-4xl ${won ? "text-mint" : "text-coral"}`}
          >
            {won ? "解密成功！" : "挑战失败"}
          </h1>
          <p className="text-ink-muted mt-2 text-sm">
            {won ? "你们成功破解了谜题" : "次数用完或超时，答案揭晓"}
          </p>
        </div>

        {/* 正确答案 */}
        <div className="bg-white rounded-doodle border-2 border-ink shadow-card p-5 mb-6">
          <div className="flex items-center gap-1.5 mb-3">
            <Trophy size={16} className="text-sun" />
            <h2 className="font-display text-ink text-sm">正确答案</h2>
          </div>
          <p className="font-body text-ink text-sm leading-relaxed">
            {mysteryReveal.answer}
          </p>
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
