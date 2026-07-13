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
    setPublicRooms,
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
    setHeartState,
    setHeartResult,
    setHeartGameOver,
    setCoOpPrompt,
    setCoOpTimeLeft,
    setCoOpOrientation,
    setCoOpAIJudging,
    setCoOpIncomingStroke,
    appendCoOpStroke,
    setCoOpResult,
    setEmojiQuestion,
    setEmojiOpponentAnswered,
    setEmojiReveal,
    setRoundResult,
    setGameOver,
    setDaVinciState,
    setDaVinciResult,
    setDaVinciGameOver,
    setDvOppDrewColor,
    setDvSelfDrewCard,
    setDvPassedPlayerId,
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
    // 房间列表：大厅展示用
    const onRoomList = ({ rooms }) => setPublicRooms(rooms);

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

    // ---- 德国心脏病事件 ----
    const onHeartState = (s) => setHeartState(s);
    const onHeartResult = (r) => {
      setHeartResult(r);
      // 拍铃结果音效：正确=correct，错误=wrong
      playSfx(r.type === "correct" ? sfx.correct : sfx.wrong);
    };
    const onHeartGameOver = (g) => {
      setHeartGameOver(g);
      // 游戏结束胜负音效
      const myId = useGameStore.getState().myId;
      if (g.winnerId && g.winnerId === myId) {
        playSfx(sfx.win);
      } else if (g.winnerId === null) {
        playSfx(sfx.roundEnd);
      } else {
        playSfx(sfx.lose);
      }
    };

    // ---- 合作画画事件（同时画 + AI 评分）----
    const onCoOpPrompt = (p) => setCoOpPrompt(p);
    const onCoOpOrientationChanged = (o) => setCoOpOrientation(o.orientation);
    let lastCoOpSec = 90;
    const onCoOpTimeUpdate = (t) => {
      setCoOpTimeLeft(t.timeLeft);
      // 最后 3 秒滴答音效
      const sec = Math.ceil(t.timeLeft);
      if (sec !== lastCoOpSec) {
        if (sec <= 3 && sec > 0) {
          playSfx(sfx.tickUrgent);
        }
        lastCoOpSec = sec;
      }
    };
    const onCoOpAIJudging = () => {
      setCoOpAIJudging(true);
      playSfx(sfx.click);
    };
    const onCoOpStrokeStart = (data) => {
      // 对方开始一笔
      setCoOpIncomingStroke(data.stroke);
    };
    const onCoOpStrokePoint = (data) => {
      // 对方笔画进行中：增量追加到 incoming stroke
      const cur = useGameStore.getState().coOpIncomingStroke;
      if (cur) {
        setCoOpIncomingStroke({
          ...cur,
          points: [...cur.points, data.point],
        });
      }
    };
    const onCoOpStrokeEnd = () => {
      // 对方一笔完成：把 incoming 追加到已完成列表
      const cur = useGameStore.getState().coOpIncomingStroke;
      if (cur) {
        appendCoOpStroke(cur);
      }
    };
    const onCoOpResult = (r) => {
      setCoOpResult(r);
      setCoOpAIJudging(false);
      // 结果揭晓音效
      playSfx(sfx.roundEnd);
    };

    // ---- 表情包猜词事件 ----
    const onEmojiQuestion = (q) => setEmojiQuestion(q);
    const onEmojiOpponentAnswered = () => {
      setEmojiOpponentAnswered();
      playSfx(sfx.opponentAnswered);
    };
    const onEmojiReveal = (r) => {
      setEmojiReveal(r);
      // 揭晓音效：自己答对=correct，否则=wrong
      if (r.myCorrect) {
        playSfx(sfx.correct);
      } else {
        playSfx(sfx.wrong);
      }
    };

    // ---- 达芬奇密码事件 ----
    const onDvState = (s) => setDaVinciState(s);
    const onDvDrew = (data: { playerId: string; color: "black" | "white"; number?: number; isSelf: boolean }) => {
      if (data.isSelf && typeof data.number === "number") {
        setDvSelfDrewCard({ color: data.color, number: data.number });
      } else if (!data.isSelf) {
        setDvOppDrewColor(data.color);
      }
    };
    const onDvGuessResult = (r) => {
      setDaVinciResult(r);
      playSfx(r.correct ? sfx.correct : sfx.wrong);
    };
    const onDvPassed = (data: { playerId: string }) => {
      setDvPassedPlayerId(data.playerId);
      playSfx(sfx.uiTick);
    };
    const onDvGameOver = (g) => {
      setDaVinciGameOver(g);
      const myId = useGameStore.getState().myId;
      if (g.winnerId && g.winnerId === myId) {
        playSfx(sfx.win);
      } else if (g.winnerId === null) {
        playSfx(sfx.roundEnd);
      } else {
        playSfx(sfx.lose);
      }
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
    socket.on("room:list", onRoomList);
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
    socket.on("heart:state", onHeartState);
    socket.on("heart:result", onHeartResult);
    socket.on("heart:game-over", onHeartGameOver);
    socket.on("coop:prompt", onCoOpPrompt);
    socket.on("coop:orientation-changed", onCoOpOrientationChanged);
    socket.on("coop:time-update", onCoOpTimeUpdate);
    socket.on("coop:ai-judging", onCoOpAIJudging);
    socket.on("coop:stroke-start", onCoOpStrokeStart);
    socket.on("coop:stroke-point", onCoOpStrokePoint);
    socket.on("coop:stroke-end", onCoOpStrokeEnd);
    socket.on("coop:result", onCoOpResult);
    socket.on("emoji:question", onEmojiQuestion);
    socket.on("emoji:opponent-answered", onEmojiOpponentAnswered);
    socket.on("emoji:reveal", onEmojiReveal);
    socket.on("dv:state", onDvState);
    socket.on("dv:drew", onDvDrew);
    socket.on("dv:guess-result", onDvGuessResult);
    socket.on("dv:passed", onDvPassed);
    socket.on("dv:game-over", onDvGameOver);
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
      socket.off("room:list", onRoomList);
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
      socket.off("heart:state", onHeartState);
      socket.off("heart:result", onHeartResult);
      socket.off("heart:game-over", onHeartGameOver);
      socket.off("coop:prompt", onCoOpPrompt);
      socket.off("coop:orientation-changed", onCoOpOrientationChanged);
      socket.off("coop:time-update", onCoOpTimeUpdate);
      socket.off("coop:ai-judging", onCoOpAIJudging);
      socket.off("coop:stroke-start", onCoOpStrokeStart);
      socket.off("coop:stroke-point", onCoOpStrokePoint);
      socket.off("coop:stroke-end", onCoOpStrokeEnd);
      socket.off("coop:result", onCoOpResult);
      socket.off("emoji:question", onEmojiQuestion);
      socket.off("emoji:opponent-answered", onEmojiOpponentAnswered);
      socket.off("emoji:reveal", onEmojiReveal);
      socket.off("dv:state", onDvState);
      socket.off("dv:drew", onDvDrew);
      socket.off("dv:guess-result", onDvGuessResult);
      socket.off("dv:passed", onDvPassed);
      socket.off("dv:game-over", onDvGameOver);
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
    // 拉取大厅公开房间列表
    listRooms: () => socket.emit("room:list"),
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
    // 德国心脏病
    heartFlip: (roomId: string) => socket.emit("heart:flip", { roomId }),
    heartRing: (roomId: string) => socket.emit("heart:ring", { roomId }),
    heartRestart: (roomId: string) => socket.emit("heart:restart", { roomId }),
    // 合作画画（同时画 + AI 评分）
    coOpStrokeStart: (roomId: string, stroke: { color: string; size: number; isEraser: boolean; points: { x: number; y: number }[] }) =>
      socket.emit("coop:stroke-start", { roomId, stroke }),
    coOpStrokePoint: (roomId: string, point: { x: number; y: number }) =>
      socket.emit("coop:stroke-point", { roomId, point }),
    coOpStrokeEnd: (roomId: string, stroke: { color: string; size: number; isEraser: boolean; points: { x: number; y: number }[]; author: string }) =>
      socket.emit("coop:stroke-end", { roomId, stroke }),
    setCoOpOrientation: (roomId: string, orientation: "landscape" | "portrait") =>
      socket.emit("coop:set-orientation", { roomId, orientation }),
    coOpSubmitDrawing: (roomId: string, image: string) =>
      socket.emit("coop:submit-drawing", { roomId, image }),
    coOpRestart: (roomId: string) => socket.emit("coop:restart", { roomId }),
    // 表情包猜词
    emojiSubmit: (roomId: string, questionIndex: number, guess: string) =>
      socket.emit("emoji:submit", { roomId, questionIndex, guess }),
    emojiNext: (roomId: string) => socket.emit("emoji:next", { roomId }),
    emojiRestart: (roomId: string) => socket.emit("emoji:restart", { roomId }),
    // 达芬奇密码
    dvDraw: (roomId: string) => socket.emit("dv:draw", { roomId }),
    dvGuess: (roomId: string, targetId: string, cardIndex: number, number: number) =>
      socket.emit("dv:guess", { roomId, targetId, cardIndex, number }),
    dvPass: (roomId: string) => socket.emit("dv:pass", { roomId }),
    dvRestart: (roomId: string) => socket.emit("dv:restart", { roomId }),
    cleanup: () => disconnectSocket(),
  };
}
