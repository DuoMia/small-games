import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameStore } from "@/store/gameStore";
import WordDisplay from "@/game/WordDisplay";
import DrawingPhase from "@/game/DrawingPhase";
import QuizPhase from "@/game/QuizPhase";
import RoundResult from "@/game/RoundResult";
import GameResult from "@/game/GameResult";

export default function Game() {
  const { roomId } = useParams<{ roomId: string }>();
  const { phase, room } = useGameStore();
  const navigate = useNavigate();

  // 如果没有房间信息，返回首页
  useEffect(() => {
    if (!room) {
      navigate("/");
    }
  }, [room, navigate]);

  // WAITING 阶段跳回大厅
  useEffect(() => {
    if (room && phase === "WAITING") {
      navigate(`/lobby/${room.roomId}`);
    }
  }, [room, phase, navigate]);

  if (!roomId || !room) {
    return (
      <div className="paper-bg min-h-screen flex items-center justify-center">
        <p className="text-ink-muted">跳转中...</p>
      </div>
    );
  }

  switch (phase) {
    case "WORD_DISPLAY":
      return <WordDisplay roomId={roomId} />;
    case "DRAWING":
      return <DrawingPhase roomId={roomId} />;
    case "QUIZ":
      return <QuizPhase roomId={roomId} />;
    case "ROUND_RESULT":
      return <RoundResult roomId={roomId} />;
    case "GAME_OVER":
      return <GameResult roomId={roomId} />;
    default:
      return (
        <div className="paper-bg min-h-screen flex items-center justify-center">
          <p className="text-ink-muted">跳转中...</p>
        </div>
      );
  }
}
