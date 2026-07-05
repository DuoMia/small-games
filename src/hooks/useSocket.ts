import { useEffect } from "react";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { useGameStore } from "@/store/gameStore";

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
    setCurrentQuestion,
    setQuizResult,
    setQuizReveal,
    setOpponentAnswered,
    setRoundResult,
    setGameOver,
  } = useGameStore();

  useEffect(() => {
    const socket = connectSocket();

    const onConnect = () => {
      setConnected(true);
      setMyId(socket.id || "");
      setError(null); // 连接成功后清除之前的错误提示
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => setError("无法连接到服务器");

    const onRoomCreated = () => {};
    const onRoomJoined = ({ room }) => setRoom(room);
    const onRoomUpdated = ({ room }) => setRoom(room);
    const onRoomError = ({ message }) => setError(message);

    const onGameState = ({ phase, currentRound }) => {
      setPhase(phase, currentRound);
    };
    const onGameWords = ({ words }) => setWords(words);

    const onQuizQuestion = (q) => setCurrentQuestion(q);
    const onQuizResult = (r) => setQuizResult(r);
    const onQuizOpponentAnswered = () => setOpponentAnswered(true);
    const onQuizReveal = (r) => setQuizReveal(r);

    const onRoundResult = (r) => setRoundResult(r);
    const onGameOver = (g) => setGameOver(g);
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
    socket.on("quiz:question", onQuizQuestion);
    socket.on("quiz:result", onQuizResult);
    socket.on("quiz:opponent-answered", onQuizOpponentAnswered);
    socket.on("quiz:reveal", onQuizReveal);
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
      socket.off("quiz:question", onQuizQuestion);
      socket.off("quiz:result", onQuizResult);
      socket.off("quiz:opponent-answered", onQuizOpponentAnswered);
      socket.off("quiz:reveal", onQuizReveal);
      socket.off("round:result", onRoundResult);
      socket.off("game:over", onGameOver);
      socket.off("player:left", onPlayerLeft);
    };
  }, []);

  return { socket: getSocket() };
}

/**
 * 房间操作 hook
 */
export function useRoomActions() {
  const socket = getSocket();

  return {
    createRoom: (nickname: string) => socket.emit("room:create", { nickname }),
    joinRoom: (roomId: string, nickname: string) =>
      socket.emit("room:join", { roomId, nickname }),
    toggleReady: (roomId: string) => socket.emit("room:ready", { roomId }),
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
    cleanup: () => disconnectSocket(),
  };
}
