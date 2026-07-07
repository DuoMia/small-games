import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  RotateCcw,
  LogOut,
  Send,
  Mic,
  Sparkles,
  HelpCircle,
  Trophy,
} from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { useSpeech } from "@/hooks/useSpeech";
import { sfx } from "@/audio/engine";
import Confetti from "@/components/Confetti";

// 难度显示映射
const DIFFICULTY_LABEL: Record<string, string> = {
  any: "任意",
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

export default function TurtleSoup({ roomId }: { roomId: string }) {
  const { phase } = useGameStore();

  // 根据阶段分发
  if (phase === "GAME_OVER") {
    return <TurtleResult roomId={roomId} />;
  }
  // DRAWING = 游戏中
  return <TurtlePlaying roomId={roomId} />;
}

// ============ 游戏中 ============
function TurtlePlaying({ roomId }: { roomId: string }) {
  const {
    turtleSurface,
    turtleQuestions,
    turtleGuesses,
    turtleQuestionsLeft,
    turtleJudging,
    turtleReveal,
  } = useGameStore();
  const { turtleAsk, turtleGuess } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const { listening, transcript, start, stop, supported, error: speechError } = useSpeech();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const [inputText, setInputText] = useState("");
  const [guessModalOpen, setGuessModalOpen] = useState(false);
  const [guessText, setGuessText] = useState("");

  const historyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 语音识别结果自动填入输入框
  useEffect(() => {
    if (transcript) {
      setInputText(transcript);
    }
  }, [transcript]);

  // 新提问/猜测到达时，滚动到底部
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [turtleQuestions.length, turtleGuesses.length, turtleJudging]);

  // 已揭晓则不可再操作
  const revealed = Boolean(turtleReveal);
  const canInteract = !revealed && (turtleQuestionsLeft ?? 0) > 0 && !turtleJudging;

  const handleAsk = () => {
    const q = inputText.trim();
    if (!q || !canInteract) return;
    playSfx(sfx.click);
    turtleAsk(roomId, q);
    setInputText("");
  };

  const handleMicToggle = () => {
    if (!supported) {
      playSfx(sfx.wrong);
      return;
    }
    playSfx(sfx.uiTick);
    if (listening) {
      stop();
    } else {
      start();
    }
  };

  const handleOpenGuess = () => {
    if (revealed) return;
    playSfx(sfx.click);
    setGuessText("");
    setGuessModalOpen(true);
  };

  const handleSubmitGuess = () => {
    const g = guessText.trim();
    if (!g || revealed || turtleJudging) return;
    playSfx(sfx.click);
    turtleGuess(roomId, g);
    setGuessModalOpen(false);
    setGuessText("");
  };

  if (!turtleSurface) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin text-coral mx-auto mb-3" />
          <p className="text-ink-muted">准备汤面...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="paper-bg h-[100dvh] flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex-shrink-0 px-4 py-2.5 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-base">🐢</span>
          <span className="font-display text-ink text-sm">海龟汤</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-display text-ink text-xs bg-sun px-2 py-1 rounded-full border-2 border-ink">
            {DIFFICULTY_LABEL[turtleSurface.difficulty] || turtleSurface.difficulty}
          </span>
          <span
            className={`font-display text-xs px-2 py-1 rounded-full border-2 border-ink ${
              (turtleQuestionsLeft ?? 0) <= 5 ? "bg-coral text-white" : "bg-mint text-ink"
            }`}
          >
            剩余 {turtleQuestionsLeft} 问
          </span>
        </div>
      </div>

      {/* 汤面 + 历史（可滚动） */}
      <div ref={historyRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {/* 汤面 */}
        <div className="bg-white rounded-blob border-3 border-ink shadow-card p-4 mb-3 animate-bounce-in">
          <div className="flex items-center gap-1.5 mb-2">
            <HelpCircle size={14} className="text-coral" />
            <span className="font-display text-ink text-xs">汤面</span>
            {turtleSurface.category && (
              <span className="ml-auto text-[10px] text-ink-muted bg-cream-dark px-2 py-0.5 rounded-full">
                {turtleSurface.category}
              </span>
            )}
          </div>
          <p className="font-body text-ink text-sm leading-relaxed">
            {turtleSurface.surface}
          </p>
        </div>

        {/* 提问历史 */}
        {turtleQuestions.length > 0 && (
          <div className="space-y-2 mb-3">
            {turtleQuestions.map((q, idx) => (
              <QuestionItem key={`q-${idx}`} record={q} />
            ))}
          </div>
        )}

        {/* 猜测记录 */}
        {turtleGuesses.length > 0 && (
          <div className="space-y-2 mb-3">
            {turtleGuesses.map((g, idx) => (
              <GuessItem key={`g-${idx}`} record={g} />
            ))}
          </div>
        )}

        {/* AI 思考中提示 */}
        {turtleJudging && (
          <div className="flex items-center justify-center gap-2 py-3 animate-bounce-in">
            <Loader2 size={18} className="animate-spin text-coral" />
            <span className="font-body text-sm text-ink-muted">
              {turtleJudging.type === "question" ? "主持人思考中..." : "裁判判断中..."}
            </span>
          </div>
        )}

        {/* 语音识别错误提示 */}
        {speechError && (
          <div className="text-center text-xs text-coral py-1">{speechError}</div>
        )}
      </div>

      {/* 底部输入区 */}
      <div className="flex-shrink-0 bg-white border-t-2 border-ink px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
            maxLength={100}
            disabled={revealed}
            placeholder={
              revealed ? "已揭晓" : canInteract ? "提问... (回车发送)" : "等待中..."
            }
            className="flex-1 px-3 py-2.5 rounded-doodle border-2 border-ink bg-cream font-body text-ink text-sm focus:border-coral focus:bg-white transition-colors disabled:opacity-50"
          />
          {/* 语音按钮 */}
          {supported && !revealed && (
            <button
              onClick={handleMicToggle}
              disabled={listening ? false : !canInteract}
              className={`btn-press flex-shrink-0 w-11 h-11 rounded-doodle border-2 border-ink flex items-center justify-center transition-colors ${
                listening
                  ? "bg-coral text-white animate-pulse"
                  : "bg-sun text-ink"
              }`}
              title={listening ? "停止录音" : "语音输入"}
            >
              {listening ? <Mic size={20} /> : <Mic size={20} />}
            </button>
          )}
          {/* 提交按钮 */}
          <button
            onClick={handleAsk}
            disabled={!canInteract || !inputText.trim() || listening}
            className="btn-press flex-shrink-0 w-11 h-11 rounded-doodle border-2 border-ink bg-coral text-white flex items-center justify-center disabled:opacity-40"
            title="发送提问"
          >
            <Send size={18} />
          </button>
        </div>
        {/* 揭晓按钮 */}
        <button
          onClick={handleOpenGuess}
          disabled={revealed || Boolean(turtleJudging) || listening}
          className="btn-press w-full mt-2 py-2.5 bg-ink text-cream font-display text-sm rounded-doodle border-2 border-ink shadow-soft flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          <Sparkles size={16} />
          揭晓答案
        </button>
      </div>

      {/* 揭晓弹窗 */}
      {guessModalOpen && (
        <GuessModal
          value={guessText}
          onChange={setGuessText}
          onClose={() => setGuessModalOpen(false)}
          onSubmit={handleSubmitGuess}
          disabled={Boolean(turtleJudging)}
        />
      )}
    </div>
  );
}

// ============ 单条提问 ============
function QuestionItem({
  record,
}: {
  record: { question: string; asker: string; answer: "是" | "否" | "无关" };
}) {
  const answerStyle =
    record.answer === "是"
      ? "bg-mint text-ink border-ink"
      : record.answer === "否"
      ? "bg-coral text-white border-ink"
      : "bg-cream-dark text-ink-muted border-ink-muted";
  return (
    <div className="bg-white rounded-doodle border-2 border-ink/30 p-2.5 animate-slide-up">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-ink-muted mb-0.5">
            <span className="font-display">{record.asker}</span> 问：
          </div>
          <div className="font-body text-ink text-sm break-words">{record.question}</div>
        </div>
        <span
          className={`flex-shrink-0 px-2.5 py-1 rounded-full border-2 font-display text-xs ${answerStyle}`}
        >
          {record.answer}
        </span>
      </div>
    </div>
  );
}

// ============ 单条猜测 ============
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
    ? "猜中！"
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
            <span className="font-display">{record.guesser}</span> 猜：
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

// ============ 揭晓弹窗 ============
function GuessModal({
  value,
  onChange,
  onClose,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center px-6"
      onClick={onClose}
    >
      <div
        className="bg-cream rounded-blob border-3 border-ink shadow-card p-5 w-full max-w-sm animate-bounce-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-coral" />
          <h3 className="font-display text-ink text-lg">揭晓汤底</h3>
        </div>
        <p className="text-xs text-ink-muted mb-3">
          输入你猜的真相，AI 裁判会判断是否正确
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          rows={3}
          maxLength={200}
          placeholder="你觉得真相是什么？"
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
function TurtleResult({ roomId }: { roomId: string }) {
  const { turtleReveal, room, myId } = useGameStore();
  const { turtleRestart, leaveRoom } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const navigate = useNavigate();

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  if (!turtleReveal) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-coral" />
      </div>
    );
  }

  const isHost = room?.hostId === myId;
  const won = turtleReveal.won;

  const handleLeave = () => {
    playSfx(sfx.click);
    leaveRoom(roomId);
    navigate("/");
  };

  const handleRestart = () => {
    playSfx(sfx.click);
    turtleRestart(roomId);
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
            {won ? "猜中了！" : "挑战失败"}
          </h1>
          <p className="text-ink-muted mt-2 text-sm">
            {won ? "你们成功还原了真相" : "20 问用完，真相揭晓"}
          </p>
        </div>

        {/* 汤底真相 */}
        <div className="bg-white rounded-blob border-3 border-ink shadow-card p-5 mb-6">
          <div className="flex items-center gap-1.5 mb-3">
            <Trophy size={16} className="text-sun" />
            <h2 className="font-display text-ink text-sm">汤底真相</h2>
          </div>
          <p className="font-body text-ink text-sm leading-relaxed">
            {turtleReveal.truth}
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
