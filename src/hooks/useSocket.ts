import { useEffect } from "react";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { useGameStore } from "@/store/gameStore";
import { useAudioStore } from "@/store/audioStore";
import { sfx, unlockAudio } from "@/audio/engine";
import type { Difficulty } from "@/lib/difficulty";
import type { GameType } from "@/lib/types";

/**
 * 初始化 Socket 连接并注册所有事件监听
 */
export function useSocketConnection() {
  const {
    setConnected,
    setMyId,
    setRoom,
    setError,
    setPhase,
    setWords,
    setGameConfig,
    setCurrentQuestion,
    setQuizResult,
    setQuizReveal,
    setOpponentAnswered,
    setTelepathyQuestion,
    setTelepathyReveal,
    setTelepathyOpponentChose,
    setRoundResult,
    setGameOver,
  } = useGameStore();
  const { sfxEnabled } = useAudioStore();

  useEffect(() => {
    const socket = connectSocket();

    const playSfx = (fn: () => void) => {
      if (sfxEnabled) fn();
    };

    const onConnect = () => {
      setConnected(true);
      setMyId(socket.id || "");
      setError(null);
      // 连接成功后解锁音频
      unlockAudio();
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => setError("无法连接到服务器");

    const onRoomCreated = () => {};
    let prevPlayerCount = 1;
    const onRoomJoined = ({ room }) => {
      setRoom(room);
      // 对手加入提示（玩家数从 1 变 2）
      if (room.players.length > prevPlayerCount) {
        playSfx(sfx.opponentJoin);
      }
      prevPlayerCount = room.players.length;
    };
    const onRoomUpdated = ({ room }) => {
      setRoom(room);
      if (room.players.length > prevPlayerCount) {
        playSfx(sfx.opponentJoin);
      }
      prevPlayerCount = room.players.length;
    };
    const onRoomError = ({ message }) => setError(message);

    const onGameState = ({ phase, currentRound }) => {
      setPhase(phase, currentRound);
    };
    const onGameWords = ({ words }) => setWords(words);
    const onGameConfig = (c) => setGameConfig(c);

    const onQuizQuestion = (q) => setCurrentQuestion(q);
    const onQuizResult = (r) => {
      setQuizResult(r);
      playSfx(r.correct ? sfx.correct : sfx.wrong);
    };
    const onQuizOpponentAnswered = () => {
      setOpponentAnswered(true);
      playSfx(sfx.opponentAnswered);
    };
    const onQuizReveal = (r) => setQuizReveal(r);

    // ---- 默契考验事件 ----
    const onTelepathyQuestion = (q) => setTelepathyQuestion(q);
    const onTelepathyReveal = (r) => {
      setTelepathyReveal(r);
      // 揭晓音效：完全一致=correct，相邻=uiTick，其他=wrong
      if (r.match === "full") {
        playSfx(sfx.correct);
      } else if (r.match === "partial") {
        playSfx(sfx.uiTick);
      } else {
        playSfx(sfx.wrong);
      }
    };
    const onTelepathyOpponentChose = () => {
      setTelepathyOpponentChose(true);
      playSfx(sfx.opponentAnswered);
    };

    const onRoundResult = (r) => {
      setRoundResult(r);
      playSfx(sfx.roundEnd);
    };
    const onGameOver = (g) => {
      setGameOver(g);
      const myId = useGameStore.getState().myId;
      if (g.winnerId && g.winnerId === myId) {
        playSfx(sfx.win);
      } else if (g.winnerId === null) {
        playSfx(sfx.roundEnd);
      } else {
        playSfx(sfx.lose);
      }
    };
    const onPlayerLeft = () => {
      // 房间状态会通过 room:updated 更新
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:created", onRoomCreated);
    socket.on("room:joined", onRoomJoined);
    socket.on("room:updated", onRoomUpdated);
    socket.on("room:error", onRoomError);
    socket.on("game:state", onGameState);
    socket.on("game:words", onGameWords);
    socket.on("game:config", onGameConfig);
    socket.on("quiz:question", onQuizQuestion);
    socket.on("quiz:result", onQuizResult);
    socket.on("quiz:opponent-answered", onQuizOpponentAnswered);
    socket.on("quiz:reveal", onQuizReveal);
    socket.on("telepathy:question", onTelepathyQuestion);
    socket.on("telepathy:reveal", onTelepathyReveal);
    socket.on("telepathy:opponent-chose", onTelepathyOpponentChose);
    socket.on("round:result", onRoundResult);
    socket.on("game:over", onGameOver);
    socket.on("player:left", onPlayerLeft);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:created", onRoomCreated);
      socket.off("room:joined", onRoomJoined);
      socket.off("room:updated", onRoomUpdated);
      socket.off("room:error", onRoomError);
      socket.off("game:state", onGameState);
      socket.off("game:words", onGameWords);
      socket.off("game:config", onGameConfig);
      socket.off("quiz:question", onQuizQuestion);
      socket.off("quiz:result", onQuizResult);
      socket.off("quiz:opponent-answered", onQuizOpponentAnswered);
      socket.off("quiz:reveal", onQuizReveal);
      socket.off("telepathy:question", onTelepathyQuestion);
      socket.off("telepathy:reveal", onTelepathyReveal);
      socket.off("telepathy:opponent-chose", onTelepathyOpponentChose);
      socket.off("round:result", onRoundResult);
      socket.off("game:over", onGameOver);
      socket.off("player:left", onPlayerLeft);
    };
  }, [sfxEnabled]);

  return { socket: getSocket() };
}

/**
 * 房间操作 hook
 */
export function useRoomActions() {
  const socket = getSocket();

  return {
    createRoom: (nickname: string, gameType: GameType = "draw-memory") =>
      socket.emit("room:create", { nickname, gameType }),
    joinRoom: (roomId: string, nickname: string) =>
      socket.emit("room:join", { roomId, nickname }),
    toggleReady: (roomId: string) => socket.emit("room:ready", { roomId }),
    setWordsCount: (roomId: string, count: number) =>
      socket.emit("room:set-words-count", { roomId, count }),
    setDifficulty: (roomId: string, difficulty: Difficulty) =>
      socket.emit("room:set-difficulty", { roomId, difficulty }),
    setTelepathyPack: (roomId: string, packId: string) =>
      socket.emit("room:set-telepathy-pack", { roomId, packId }),
    startGame: (roomId: string) => socket.emit("game:start", { roomId }),
    leaveRoom: (roomId: string) => socket.emit("room:leave", { roomId }),
    nextStage: (roomId: string) => socket.emit("game:next-stage", { roomId }),
    uploadDrawings: (roomId: string, drawings: string[]) =>
      socket.emit("drawing:upload", { roomId, drawings }),
    submitAnswer: (roomId: string, questionIndex: number, answer: string) =>
      socket.emit("quiz:submit", { roomId, questionIndex, answer }),
    nextQuestion: (roomId: string) => socket.emit("quiz:next", { roomId }),
    nextRound: (roomId: string) => socket.emit("round:next", { roomId }),
    restartGame: (roomId: string) => socket.emit("game:restart", { roomId }),
    // 默契考验
    telepathyChoose: (roomId: string, questionIndex: number, choice: number) =>
      socket.emit("telepathy:choose", { roomId, questionIndex, choice }),
    telepathyNext: (roomId: string) => socket.emit("telepathy:next", { roomId }),
    telepathyRestart: (roomId: string) => socket.emit("telepathy:restart", { roomId }),
    cleanup: () => disconnectSocket(),
  };
}
