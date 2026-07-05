import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../game/types.js";
import { RoomManager } from "../game/RoomManager.js";
import { VIEW_TIME, DRAW_TIME, WORD_DURATION } from "../game/difficulty.js";

type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;
type Io = Server<ClientToServerEvents, ServerToClientEvents>;

export function registerSocketHandlers(io: Io) {
  io.on("connection", (socket: Sock) => {
    console.log(`[Socket] 已连接: ${socket.id}`);

    // ---------- 房间相关 ----------

    socket.on("room:create", ({ nickname }) => {
      const room = RoomManager.createRoom(nickname, socket.id);
      socket.join(room.roomId);
      socket.emit("room:created", { roomId: room.roomId });
      socket.emit("room:joined", { room: RoomManager.toRoomView(room) });
    });

    socket.on("room:join", ({ roomId, nickname }) => {
      const room = RoomManager.joinRoom(roomId, nickname, socket.id);
      if (!room) {
        socket.emit("room:error", { message: "房间不存在或已满" });
        return;
      }
      socket.join(room.roomId);
      const view = RoomManager.toRoomView(room);
      socket.emit("room:joined", { room: view });
      io.to(room.roomId).emit("room:updated", { room: view });
    });

    socket.on("room:ready", ({ roomId }) => {
      const room = RoomManager.toggleReady(roomId, socket.id);
      if (room) {
        io.to(roomId).emit("room:updated", { room: RoomManager.toRoomView(room) });
      }
    });

    socket.on("room:set-words-count", ({ roomId, count }) => {
      const room = RoomManager.setWordsPerRound(roomId, socket.id, count);
      if (room) {
        io.to(roomId).emit("room:updated", { room: RoomManager.toRoomView(room) });
      } else {
        socket.emit("room:error", { message: "无法修改题量" });
      }
    });

    socket.on("room:set-difficulty", ({ roomId, difficulty }) => {
      const room = RoomManager.setDifficulty(roomId, socket.id, difficulty);
      if (room) {
        io.to(roomId).emit("room:updated", { room: RoomManager.toRoomView(room) });
      } else {
        socket.emit("room:error", { message: "无法修改难度" });
      }
    });

    socket.on("room:leave", ({ roomId }) => {
      handleLeave(io, socket, roomId);
    });

    // ---------- 游戏流程 ----------

    socket.on("game:start", ({ roomId }) => {
      const result = RoomManager.startGame(roomId, socket.id);
      if (!result) {
        socket.emit("room:error", { message: "无法开始游戏" });
        return;
      }
      const { room, words } = result;
      io.to(roomId).emit("game:state", {
        phase: room.state.phase,
        currentRound: room.state.currentRound,
      });
      io.to(roomId).emit("game:words", { words });
      // 下发统一的时间参数 + 题量（题数=词数），前端据此驱动倒计时
      io.to(roomId).emit("game:config", {
        viewTime: VIEW_TIME,
        drawTime: DRAW_TIME,
        wordDuration: WORD_DURATION,
        totalQuestions: room.wordsPerRound,
      });
    });

    socket.on("game:next-stage", ({ roomId }) => {
      const room = RoomManager.advanceFromWordDisplay(roomId, socket.id);
      if (room && room.state.phase === "DRAWING") {
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
      }
    });

    socket.on("drawing:upload", ({ roomId, drawings }) => {
      const result = RoomManager.uploadDrawings(roomId, socket.id, drawings);
      if (!result) {
        console.log(`[drawing:upload] ${socket.id} 提交失败（房间不存在或阶段错误）`);
        return;
      }
      console.log(
        `[drawing:upload] ${socket.id} 已提交，房间 ${roomId}，全部完成: ${result.allUploaded}`
      );
      if (result.allUploaded) {
        const room = result.room;
        // 广播阶段切换到 QUIZ
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        // 发送第一道题（确保 questions 已生成）
        const question = room.state.questions[0];
        if (question) {
          io.to(roomId).emit("quiz:question", {
            questionIndex: 0,
            wordIndex: question.wordIndex,
            totalQuestions: room.state.questions.length,
          });
        } else {
          console.error(`[drawing:upload] 房间 ${roomId} 题目生成失败，questions 为空`);
        }
      } else {
        // 通知房间内玩家：有人已提交，等待其余玩家
        io.to(roomId).emit("drawing:wait", { playerId: socket.id });
      }
    });

    // ---------- 答题 ----------

    socket.on("quiz:submit", ({ roomId, questionIndex, answer }) => {
      const result = RoomManager.submitAnswer(roomId, socket.id, questionIndex, answer);
      if (!result) return;

      // 给提交者返回结果
      socket.emit("quiz:result", {
        questionIndex,
        correct: result.correct,
        correctAnswer: result.correctAnswer,
        score: result.score,
      });

      // 通知对手已答题
      socket.to(roomId).emit("quiz:opponent-answered", { questionIndex });

      // 双方都答完，揭晓对手答案
      if (result.allAnswered) {
        const room = RoomManager.getRoom(roomId);
        if (room) {
          room.players.forEach((p) => {
            const opp = room.players.find((op) => op.id !== p.id);
            if (opp) {
              const oppAnswer = room.state.answers[opp.id] || "";
              const oppCorrect = room.state.answerResults[opp.id] || false;
              io.to(p.id).emit("quiz:reveal", {
                questionIndex,
                opponentAnswer: oppAnswer,
                opponentCorrect: oppCorrect,
              });
            }
          });
        }
      }
    });

    socket.on("quiz:next", ({ roomId }) => {
      const result = RoomManager.nextQuestion(roomId, socket.id);
      if (!result) return;

      if (result.isLast) {
        // 回合结算
        const room = result.room;
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const roundData = RoomManager.getRoundResultData(room);
        io.to(roomId).emit("round:result", roundData);
      } else if (result.nextIndex >= 0) {
        // 下一题
        const room = result.room;
        const question = room.state.questions[result.nextIndex];
        io.to(roomId).emit("quiz:question", {
          questionIndex: result.nextIndex,
          wordIndex: question.wordIndex,
          totalQuestions: room.state.questions.length,
        });
      }
    });

    socket.on("round:next", ({ roomId }) => {
      const result = RoomManager.nextRound(roomId, socket.id);
      if (!result) return;

      if (result.isGameOver) {
        const room = result.room;
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const overData = RoomManager.getGameOverData(room);
        io.to(roomId).emit("game:over", overData);
      } else {
        const room = result.room;
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        io.to(roomId).emit("game:words", { words: result.words });
      }
    });

    socket.on("game:restart", ({ roomId }) => {
      const result = RoomManager.restartGame(roomId, socket.id);
      if (!result) return;
      const room = result.room;
      io.to(roomId).emit("game:state", {
        phase: room.state.phase,
        currentRound: room.state.currentRound,
      });
      io.to(roomId).emit("game:words", { words: result.words });
      io.to(roomId).emit("game:config", {
        viewTime: VIEW_TIME,
        drawTime: DRAW_TIME,
        wordDuration: WORD_DURATION,
        totalQuestions: room.wordsPerRound,
      });
    });

    // ---------- 断线处理 ----------

    socket.on("disconnect", () => {
      console.log(`[Socket] 断开: ${socket.id}`);
      const info = RoomManager.setPlayerOffline(socket.id);
      if (info && info.room) {
        io.to(info.roomId).emit("player:left", { playerId: socket.id });
        io.to(info.roomId).emit("room:updated", {
          room: RoomManager.toRoomView(info.room),
        });
      }
    });
  });
}

function handleLeave(io: Io, socket: Sock, roomId: string) {
  const { room, shouldDelete } = RoomManager.leaveRoom(roomId, socket.id);
  socket.leave(roomId);
  if (!shouldDelete && room) {
    io.to(roomId).emit("room:updated", { room: RoomManager.toRoomView(room) });
    io.to(roomId).emit("player:left", { playerId: socket.id });
  }
}
