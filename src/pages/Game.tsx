import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameStore } from "@/store/gameStore";
import WordDisplay from "@/game/WordDisplay";
import DrawingPhase from "@/game/DrawingPhase";
import QuizPhase from "@/game/QuizPhase";
import RoundResult from "@/game/RoundResult";
import GameResult from "@/game/GameResult";
import TelepathyGame from "@/game/TelepathyGame";
import HeartAttackGame from "@/game/HeartAttackGame";
import CoOpDrawing from "@/game/CoOpDrawing";
import EmojiGuessing from "@/game/EmojiGuessing";

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
      <div className="paper-bg h-[100dvh] flex items-center justify-center">
        <p className="text-ink-muted">跳转中...</p>
      </div>
    );
  }

  // 默契考验：统一交给 TelepathyGame 处理（内部按 phase 分发，含 GAME_OVER）
  if (room.gameType === "telepathy") {
    return <TelepathyGame roomId={roomId} />;
  }

  // 德国心脏病：统一交给 HeartAttackGame 处理
  if (room.gameType === "heart-attack") {
    return <HeartAttackGame roomId={roomId} />;
  }

  // 合作画画：统一交给 CoOpDrawing 处理
  if (room.gameType === "co-op-drawing") {
    return <CoOpDrawing roomId={roomId} />;
  }

  // 表情包猜词：统一交给 EmojiGuessing 处理
  if (room.gameType === "emoji-guessing") {
    return <EmojiGuessing roomId={roomId} />;
  }

  // 画词记忆：原有逻辑
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
        <div className="paper-bg h-[100dvh] flex items-center justify-center">
          <p className="text-ink-muted">跳转中...</p>
        </div>
      );
  }
}
