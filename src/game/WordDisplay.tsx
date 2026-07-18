import { useState, useEffect, useRef } from "react";
import { Eye, ArrowRight } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import { useAudioStore } from "@/store/audioStore";
import { sfx } from "@/audio/engine";

// 默认每词5秒（normal），后端 game:config 下发后更新
const DEFAULT_WORD_DURATION = 5;

export default function WordDisplay({ roomId }: { roomId: string }) {
  const { words, currentRound, gameConfig } = useGameStore();
  const { nextStage } = useRoomActions();
  const { sfxEnabled } = useAudioStore();
  const wordDuration = gameConfig?.wordDuration ?? DEFAULT_WORD_DURATION;

  const playSfx = (fn: () => void) => {
    if (sfxEnabled) fn();
  };

  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(wordDuration);
  const finishedRef = useRef(false);
  const lastSecRef = useRef<number>(-1);

  useEffect(() => {
    if (words.length === 0) return;
    if (currentIndex >= words.length) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        setTimeout(() => nextStage(roomId), 500);
      }
      return;
    }

    setTimeLeft(wordDuration);
    lastSecRef.current = Math.ceil(wordDuration);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, wordDuration - elapsed);
      setTimeLeft(left);
      const sec = Math.ceil(left);
      if (sec !== lastSecRef.current && sec > 0) {
        lastSecRef.current = sec;
        if (left <= 3 && left > 0) {
          playSfx(sfx.tickUrgent);
        } else {
          playSfx(sfx.tick);
        }
      }
      if (left <= 0) {
        clearInterval(interval);
        setCurrentIndex((prev) => prev + 1);
      }
    }, 50);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, words, roomId, nextStage, wordDuration, sfxEnabled]);

  const isFinished = currentIndex >= words.length;
  const currentWord = !isFinished ? words[currentIndex] : "";
  const progress =
    ((currentIndex + (wordDuration - timeLeft) / wordDuration) / words.length) *
    100;

  return (
    <div className="paper-bg h-[100dvh] flex flex-col">
      {/* 顶栏 */}
      <div className="px-5 py-3 flex items-center justify-between border-b-2 border-ink-muted/20">
        <div className="flex items-center gap-2">
          <span className="font-display text-ink">第 {currentRound} 轮</span>
          <span className="text-ink-muted text-sm">· 看词阶段</span>
        </div>
        <div className="flex items-center gap-1.5 bg-coral text-white px-3 py-1 rounded-full">
          <Eye size={16} />
          <span className="font-display text-sm">记忆中</span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="px-5 py-2">
        <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
          <span>{Math.min(currentIndex + 1, words.length)} / {words.length}</span>
          <span>{Math.ceil(timeLeft)}s</span>
        </div>
        <div className="h-2 bg-cream-dark rounded-full overflow-hidden">
          <div
            className="h-full bg-coral rounded-full transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 词语展示区 */}
      <div className="flex-1 flex items-center justify-center px-5">
        {!isFinished ? (
          <div
            key={currentIndex}
            className="text-center animate-slide-right"
          >
            <div className="inline-block bg-white rounded-blob border-3 border-ink shadow-card px-8 py-10 relative">
              {/* 序号标签 */}
              <div className="absolute -top-3 -left-3 bg-sun text-ink font-display text-sm px-3 py-1 rounded-full border-2 border-ink">
                #{currentIndex + 1}
              </div>
              {/* 词语 */}
              <div className="font-display text-6xl text-ink leading-tight">
                {currentWord}
              </div>
              {/* 倒计时圆点 */}
              <div className="flex items-center justify-center gap-1.5 mt-4">
                {Array.from({ length: wordDuration }, (_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      i < wordDuration - Math.ceil(timeLeft)
                        ? "bg-coral"
                        : "bg-cream-dark"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center animate-bounce-in">
            <div className="text-6xl mb-4">✅</div>
            <p className="font-display text-2xl text-ink">词语展示完毕</p>
            <p className="text-ink-muted text-sm mt-2">准备画画...</p>
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-5 py-4 text-center">
        <p className="text-ink-muted text-sm flex items-center justify-center gap-1">
          <ArrowRight size={16} className="animate-pulse" />
          记住每个词语的顺序，等下要按序号作画
        </p>
      </div>
    </div>
  );
}
