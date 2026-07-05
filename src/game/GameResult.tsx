import { useNavigate } from "react-router-dom";
import { Trophy, RotateCcw, LogOut } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useRoomActions } from "@/hooks/useSocket";
import Confetti from "@/components/Confetti";

export default function GameResult({ roomId }: { roomId: string }) {
  const { gameOver, room, myId } = useGameStore();
  const { restartGame, leaveRoom } = useRoomActions();
  const navigate = useNavigate();

  if (!gameOver) {
    return (
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <p className="text-ink-muted">加载中...</p>
      </div>
    );
  }

  const { finalScores, winnerId } = gameOver;
  const isHost = room?.hostId === myId;
  const isWinner = winnerId === myId;
  const isDraw = !winnerId;
  const winner = finalScores.find((p) => p.id === winnerId);
  const sortedScores = [...finalScores].sort((a, b) => b.totalScore - a.totalScore);

  const handleLeave = () => {
    leaveRoom(roomId);
    navigate("/");
  };

  const handleRestart = () => {
    restartGame(roomId);
  };

  return (
    <div className="paper-bg h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-8 relative">
      {/* 彩屑 */}
      {!isDraw && <Confetti />}

      <div className="w-full max-w-md relative z-10">
        {/* 胜负宣告 */}
        <div className="text-center mb-8 animate-bounce-in">
          {isDraw ? (
            <>
              <div className="text-7xl mb-3">🤝</div>
              <h1 className="font-display text-5xl text-ink">平局！</h1>
              <p className="text-ink-muted mt-2">势均力敌</p>
            </>
          ) : isWinner ? (
            <>
              <div className="text-7xl mb-3 animate-float">🏆</div>
              <h1 className="font-display text-5xl text-coral">你赢了！</h1>
              <p className="text-ink-muted mt-2">太厉害了！记忆力满分 🎉</p>
            </>
          ) : (
            <>
              <div className="text-7xl mb-3">💪</div>
              <h1 className="font-display text-5xl text-ink">
                {winner?.nickname} 获胜
              </h1>
              <p className="text-ink-muted mt-2">下次再战！</p>
            </>
          )}
        </div>

        {/* 最终得分 */}
        <div className="bg-white rounded-blob border-3 border-ink shadow-card p-5 mb-6">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Trophy size={20} className="text-sun" />
            <h2 className="font-display text-ink text-lg">最终得分</h2>
          </div>
          <div className="space-y-3">
            {sortedScores.map((player, idx) => (
              <div
                key={player.id}
                className={`flex items-center gap-3 p-3 rounded-doodle border-2 ${
                  player.id === winnerId
                    ? "border-sun bg-sun/10"
                    : "border-ink/20 bg-cream"
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full font-display text-sm border-2 border-ink ${
                    idx === 0
                      ? "bg-sun text-ink"
                      : idx === 1
                      ? "bg-cream-dark text-ink"
                      : "bg-white text-ink"
                  }`}
                >
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <span className="font-display text-ink">
                    {player.nickname}
                    {player.id === myId && (
                      <span className="text-xs text-coral ml-1">(我)</span>
                    )}
                  </span>
                </div>
                <div className="font-display text-3xl text-coral">
                  {player.totalScore}
                </div>
                <div className="text-xs text-ink-muted">分</div>
              </div>
            ))}
          </div>
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
