import { useState } from "react";
import { ArrowRight, Trophy, X } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import PlayerCard from "@/components/PlayerCard";

export default function RoundResult({ roomId }: { roomId: string }) {
  const { roundResult, currentRound, room, myId } = useGameStore();
  const { nextRound } = useRoomActions();
  const [viewMode, setViewMode] = useState<"me" | "opponent">("me");
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (!roundResult) {
    return (
      <div className="paper-bg min-h-screen flex items-center justify-center">
        <p className="text-ink-muted">加载中...</p>
      </div>
    );
  }

  const me = roundResult.scores.find((p) => p.id === myId);
  const opponent = roundResult.scores.find((p) => p.id !== myId);
  const isHost = room?.hostId === myId;

  const viewedPlayerId =
    viewMode === "me" ? myId : opponent?.id;
  const viewedDrawings = viewedPlayerId
    ? roundResult.drawings[viewedPlayerId] || []
    : [];
  const viewedPlayer = roundResult.scores.find(
    (p) => p.id === viewedPlayerId
  );

  return (
    <div className="paper-bg min-h-screen flex flex-col">
      {/* 顶栏 */}
      <div className="px-4 py-3 flex items-center justify-between border-b-2 border-ink-muted/20 bg-white/50">
        <span className="font-display text-ink text-sm">
          第 {currentRound} 轮 · 结算
        </span>
        <Trophy size={20} className="text-sun" />
      </div>

      {/* 得分板 */}
      <div className="px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          {roundResult.scores.map((player) => (
            <div
              key={player.id}
              className={`rounded-blob border-3 p-3 text-center ${
                player.id === myId
                  ? "border-coral bg-coral/10"
                  : "border-ink bg-white"
              }`}
            >
              <div className="font-display text-sm text-ink truncate">
                {player.nickname}
                {player.id === myId && (
                  <span className="text-xs ml-1">(我)</span>
                )}
              </div>
              <div className="font-display text-4xl text-coral mt-1">
                +{player.roundScore}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                总分：{player.totalScore}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 画作墙 */}
      <div className="flex-1 px-4 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display text-ink text-sm">画作回顾</h3>
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode("me")}
              className={`px-3 py-1 text-xs font-display rounded-full border-2 ${
                viewMode === "me"
                  ? "bg-coral text-white border-ink"
                  : "bg-white text-ink border-ink/30"
              }`}
            >
              我的画
            </button>
            {opponent && (
              <button
                onClick={() => setViewMode("opponent")}
                className={`px-3 py-1 text-xs font-display rounded-full border-2 ${
                  viewMode === "opponent"
                    ? "bg-ink text-cream border-ink"
                    : "bg-white text-ink border-ink/30"
                }`}
              >
                对手的画
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto hide-scrollbar pb-2">
          <div className="grid grid-cols-3 gap-1.5">
            {viewedDrawings.map((drawing, idx) => (
              <button
                key={idx}
                onClick={() => drawing && setLightbox(drawing)}
                className="aspect-square rounded-lg border-2 border-ink/20 overflow-hidden bg-white relative"
              >
                {drawing ? (
                  <img
                    src={drawing}
                    alt={`画作${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ink-muted text-xs">
                    {idx + 1}
                  </div>
                )}
                <span className="absolute top-0.5 left-0.5 text-[10px] bg-sun/90 text-ink px-1 rounded font-display">
                  {idx + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 下一轮按钮 */}
      <div className="bg-white border-t-2 border-ink px-4 py-3">
        {isHost ? (
          <button
            onClick={() => nextRound(roomId)}
            className="btn-press w-full py-3 bg-coral text-white font-display text-lg rounded-doodle border-2 border-ink shadow-pop flex items-center justify-center gap-2"
          >
            {currentRound >= 3 ? "查看最终结果" : `开始第 ${currentRound + 1} 轮`}
            <ArrowRight size={20} />
          </button>
        ) : (
          <div className="text-center py-3 text-ink-muted text-sm">
            等待房主开始下一轮...
          </div>
        )}
      </div>

      {/* 图片放大查看 */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-ink/80 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-4 right-4 text-white p-2">
            <X size={28} />
          </button>
          <img
            src={lightbox}
            alt="画作放大"
            className="max-w-full max-h-full rounded-doodle border-4 border-white"
          />
        </div>
      )}
    </div>
  );
}
