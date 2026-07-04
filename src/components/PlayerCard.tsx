import { Crown } from "lucide-react";
import type { PlayerView } from "@/lib/types";

interface PlayerCardProps {
  player: PlayerView;
  isMe?: boolean;
  showScore?: boolean;
  scoreLabel?: string;
  variant?: "default" | "compact";
}

export default function PlayerCard({
  player,
  isMe = false,
  showScore = false,
  scoreLabel = "分",
  variant = "default",
}: PlayerCardProps) {
  const isCompact = variant === "compact";

  return (
    <div
      className={`relative rounded-blob border-3 border-ink bg-white p-4 shadow-card transition-all ${
        isMe ? "ring-4 ring-sun" : ""
      } ${isCompact ? "p-2" : ""}`}
    >
      {player.isHost && !isCompact && (
        <div className="absolute -top-3 -right-2 bg-sun rounded-full p-1.5 shadow-soft border-2 border-ink">
          <Crown size={16} className="text-ink" />
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* 头像（emoji 头像） */}
        <div
          className={`flex items-center justify-center rounded-full bg-coral-light border-2 border-ink font-display text-ink ${
            isCompact ? "w-8 h-8 text-sm" : "w-12 h-12 text-xl"
          }`}
        >
          {player.nickname.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-display text-ink truncate ${
                isCompact ? "text-sm" : "text-lg"
              }`}
            >
              {player.nickname}
            </span>
            {isMe && (
              <span className="text-xs bg-mint text-white px-1.5 py-0.5 rounded-full font-bold">
                我
              </span>
            )}
          </div>

          {!isCompact && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  player.isReady
                    ? "bg-mint"
                    : player.online
                    ? "bg-warn"
                    : "bg-ink-muted"
                }`}
              />
              <span className="text-xs text-ink-muted">
                {!player.online
                  ? "离线"
                  : player.isReady
                  ? "已准备"
                  : "未准备"}
              </span>
            </div>
          )}
        </div>

        {showScore && (
          <div className="text-right">
            <div
              className={`font-display text-coral ${
                isCompact ? "text-xl" : "text-3xl"
              }`}
            >
              {player.totalScore}
            </div>
            <div className="text-xs text-ink-muted">{scoreLabel}</div>
          </div>
        )}
      </div>
    </div>
  );
}
