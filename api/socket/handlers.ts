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

    socket.on("room:create", ({ nickname, gameType }) => {
      const room = RoomManager.createRoom(nickname, socket.id, gameType || "draw-memory");
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

    // 房间列表：返回所有公开等待中的房间，用于大厅展示
    socket.on("room:list", () => {
      const rooms = RoomManager.listPublicRooms();
      socket.emit("room:list", { rooms });
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

    socket.on("room:set-telepathy-pack", ({ roomId, packId }) => {
      const room = RoomManager.setTelepathyPack(roomId, socket.id, packId);
      if (room) {
        io.to(roomId).emit("room:updated", { room: RoomManager.toRoomView(room) });
      } else {
        socket.emit("room:error", { message: "无法修改题包" });
      }
    });

    socket.on("room:leave", ({ roomId }) => {
      handleLeave(io, socket, roomId);
    });

    // ---------- 游戏流程 ----------

    socket.on("game:start", async ({ roomId }) => {
      const result = await RoomManager.startGame(roomId, socket.id);
      if (!result) {
        socket.emit("room:error", { message: "无法开始游戏" });
        return;
      }
      const { room, words } = result;

      if (room.gameType === "telepathy") {
        // 默契考验：下发题目数据，进入选择阶段
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const q = RoomManager.getCurrentTelepathyQuestion(room);
        if (q) {
          io.to(roomId).emit("telepathy:question", q);
        }
        // 总题量配置
        io.to(roomId).emit("game:config", {
          viewTime: VIEW_TIME,
          drawTime: DRAW_TIME,
          wordDuration: WORD_DURATION,
          totalQuestions: q?.totalQuestions ?? 10,
        });
        return;
      }

      if (room.gameType === "heart-attack") {
        // 德国心脏病：已生成牌堆，分别下发各玩家视角的初始状态
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        room.players.forEach((p) => {
          const view = RoomManager.getHeartStateView(room, p.id);
          if (view) {
            io.to(p.id).emit("heart:state", view);
          }
        });
        return;
      }

      if (room.gameType === "co-op-drawing") {
        // 合作画画：下发命题 + 方向，进入 DRAWING（双方同时画）
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        io.to(roomId).emit("coop:prompt", {
          prompt: room.state.coOpPrompt || "",
          orientation: RoomManager.getCoOpOrientation(room),
        });
        // 启动 90 秒倒计时
        startCoOpTimer(io, roomId);
        return;
      }

      if (room.gameType === "emoji-guessing") {
        // 表情包猜词：下发第一题，进入 DRAWING（答题中）
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const q = RoomManager.getCurrentEmojiQuestion(room);
        if (q) {
          io.to(roomId).emit("emoji:question", q);
        }
        io.to(roomId).emit("game:config", {
          viewTime: VIEW_TIME,
          drawTime: DRAW_TIME,
          wordDuration: WORD_DURATION,
          totalQuestions: q?.totalQuestions ?? 10,
        });
        return;
      }

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

    socket.on("game:restart", async ({ roomId }) => {
      const result = await RoomManager.restartGame(roomId, socket.id);
      if (!result) return;
      const room = result.room;

      if (room.gameType === "telepathy") {
        // 默契考验重玩
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const q = RoomManager.getCurrentTelepathyQuestion(room);
        if (q) {
          io.to(roomId).emit("telepathy:question", q);
        }
        io.to(roomId).emit("game:config", {
          viewTime: VIEW_TIME,
          drawTime: DRAW_TIME,
          wordDuration: WORD_DURATION,
          totalQuestions: q?.totalQuestions ?? 10,
        });
        return;
      }

      if (room.gameType === "heart-attack") {
        // 德国心脏病重玩（重新洗牌）
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        room.players.forEach((p) => {
          const view = RoomManager.getHeartStateView(room, p.id);
          if (view) {
            io.to(p.id).emit("heart:state", view);
          }
        });
        return;
      }

      if (room.gameType === "co-op-drawing") {
        // 合作画画重玩（换命题，重新计时）
        stopCoOpTimer(roomId);
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        io.to(roomId).emit("coop:prompt", {
          prompt: room.state.coOpPrompt || "",
          orientation: RoomManager.getCoOpOrientation(room),
        });
        // 重新启动 90 秒倒计时
        startCoOpTimer(io, roomId);
        return;
      }

      if (room.gameType === "emoji-guessing") {
        // 表情包猜词重玩（换题）
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const q = RoomManager.getCurrentEmojiQuestion(room);
        if (q) {
          io.to(roomId).emit("emoji:question", q);
        }
        io.to(roomId).emit("game:config", {
          viewTime: VIEW_TIME,
          drawTime: DRAW_TIME,
          wordDuration: WORD_DURATION,
          totalQuestions: q?.totalQuestions ?? 10,
        });
        return;
      }

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

    // ---------- 默契考验（心灵感应）----------

    socket.on("telepathy:choose", ({ roomId, questionIndex, choice }) => {
      const result = RoomManager.submitTelepathyChoice(roomId, socket.id, questionIndex, choice);
      if (!result) return;
      const { room, allChosen } = result;

      if (!allChosen) {
        // 仅自己选完，通知对方
        socket.to(roomId).emit("telepathy:opponent-chose", { questionIndex });
        return;
      }

      // 双方都选完，广播揭晓数据（每个玩家视角不同）
      room.players.forEach((p) => {
        const reveal = RoomManager.getTelepathyRevealData(room, p.id);
        if (reveal) {
          io.to(p.id).emit("telepathy:reveal", reveal);
        }
      });
      // 通知阶段切换到 QUIZ（揭晓）
      io.to(roomId).emit("game:state", {
        phase: room.state.phase,
        currentRound: room.state.currentRound,
      });
    });

    socket.on("telepathy:next", ({ roomId }) => {
      const result = RoomManager.nextTelepathyQuestion(roomId, socket.id);
      if (!result) return;
      const { room, isLast } = result;

      if (isLast) {
        // 游戏结束
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const overData = RoomManager.getGameOverData(room);
        io.to(roomId).emit("game:over", overData);
      } else {
        // 下一题
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const q = RoomManager.getCurrentTelepathyQuestion(room);
        if (q) {
          io.to(roomId).emit("telepathy:question", q);
        }
      }
    });

    socket.on("telepathy:restart", ({ roomId }) => {
      const result = RoomManager.restartTelepathy(roomId, socket.id);
      if (!result) return;
      const room = result.room;
      io.to(roomId).emit("game:state", {
        phase: room.state.phase,
        currentRound: room.state.currentRound,
      });
      const q = RoomManager.getCurrentTelepathyQuestion(room);
      if (q) {
        io.to(roomId).emit("telepathy:question", q);
      }
      io.to(roomId).emit("game:config", {
        viewTime: VIEW_TIME,
        drawTime: DRAW_TIME,
        wordDuration: WORD_DURATION,
        totalQuestions: q?.totalQuestions ?? 10,
      });
    });

    // ---------- 德国心脏病 ----------

    socket.on("heart:flip", ({ roomId }) => {
      const result = RoomManager.flipHeartCard(roomId, socket.id);
      if (result.ok === false) {
        socket.emit("room:error", { message: result.error });
        return;
      }
      const room = result.room;
      // 双方都翻完后，如果桌面无 fruit=5，自动推进到下一轮
      const allFlipped = room.players.every((p) => room.state.heartFlipped?.[p.id]);
      if (allFlipped) {
        const advanced = RoomManager.nextHeartRound(roomId);
        if (advanced) room.state = advanced.state;
      }
      // 广播最新状态给双方（视角不同）
      room.players.forEach((p) => {
        const view = RoomManager.getHeartStateView(room, p.id);
        if (view) {
          io.to(p.id).emit("heart:state", view);
        }
      });
    });

    socket.on("heart:ring", ({ roomId }) => {
      const result = RoomManager.ringHeartBell(roomId, socket.id);
      if (result.ok === false) {
        socket.emit("room:error", { message: result.error });
        return;
      }
      const room = result.room;
      // 广播拍铃结果给房间所有人
      io.to(roomId).emit("heart:result", {
        type: result.type,
        ringerId: result.ringerId,
        ringerNickname: result.ringerNickname,
      });
      // 如果游戏结束
      if (result.gameOver) {
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        room.players.forEach((p) => {
          const overData = RoomManager.getHeartGameOverData(room, p.id);
          if (overData) {
            io.to(p.id).emit("heart:game-over", overData);
          }
        });
        return;
      }
      // 广播最新状态给双方
      room.players.forEach((p) => {
        const view = RoomManager.getHeartStateView(room, p.id);
        if (view) {
          io.to(p.id).emit("heart:state", view);
        }
      });
    });

    socket.on("heart:restart", ({ roomId }) => {
      const room = RoomManager.restartHeartAttack(roomId, socket.id);
      if (!room) return;
      io.to(roomId).emit("game:state", {
        phase: room.state.phase,
        currentRound: room.state.currentRound,
      });
      room.players.forEach((p) => {
        const view = RoomManager.getHeartStateView(room, p.id);
        if (view) {
          io.to(p.id).emit("heart:state", view);
        }
      });
    });

    // ---------- 合作画画（同时画 + AI 评分）----------

    socket.on("coop:set-orientation", ({ roomId, orientation }) => {
      const room = RoomManager.setCoOpOrientation(roomId, socket.id, orientation);
      if (room) {
        io.to(roomId).emit("coop:orientation-changed", {
          orientation: RoomManager.getCoOpOrientation(room),
        });
      } else {
        socket.emit("room:error", { message: "无法修改画布方向" });
      }
    });

    socket.on("coop:stroke-start", ({ roomId, stroke }) => {
      const result = RoomManager.coOpStrokeStart(roomId, socket.id, stroke);
      if (!result) return;
      // 实时广播给除发送者外的玩家
      socket.to(roomId).emit("coop:stroke-start", { stroke: result.fullStroke });
    });

    socket.on("coop:stroke-point", ({ roomId, point }) => {
      const result = RoomManager.coOpStrokePoint(roomId, socket.id, point);
      if (!result) return;
      socket.to(roomId).emit("coop:stroke-point", { point });
    });

    socket.on("coop:stroke-end", ({ roomId, stroke }) => {
      const result = RoomManager.coOpStrokeEnd(roomId, socket.id, stroke);
      if (!result) return;
      // 通知对方一笔完成（对方据此把 incoming 追加到已完成列表）
      socket.to(roomId).emit("coop:stroke-end", {});
    });

    socket.on("coop:submit-drawing", async ({ roomId, image }) => {
      // 房主提交渲染好的画作图片，触发 AI 评分
      const room = RoomManager.getRoom(roomId);
      if (!room) return;
      // 仅房主提交，避免重复
      if (room.hostId !== socket.id) return;
      const result = await RoomManager.judgeCoOpDrawing(roomId, socket.id, image);
      if (!result) return;
      const { room: r, aiScore, aiComment } = result;
      // AI 评分完成，清除兜底计时器
      stopCoOpFallback(roomId);
      io.to(roomId).emit("game:state", {
        phase: r.state.phase,
        currentRound: r.state.currentRound,
      });
      io.to(roomId).emit("coop:result", {
        finalImage: "",
        aiScore,
        aiComment,
      });
    });

    socket.on("coop:restart", ({ roomId }) => {
      const room = RoomManager.restartCoOp(roomId, socket.id);
      if (!room) return;
      stopCoOpTimer(roomId);
      io.to(roomId).emit("game:state", {
        phase: room.state.phase,
        currentRound: room.state.currentRound,
      });
      io.to(roomId).emit("coop:prompt", {
        prompt: room.state.coOpPrompt || "",
        orientation: RoomManager.getCoOpOrientation(room),
      });
      // 重新启动 90 秒倒计时
      startCoOpTimer(io, roomId);
    });

    // ---------- 表情包猜词 ----------

    socket.on("emoji:submit", ({ roomId, questionIndex, guess }) => {
      const result = RoomManager.submitEmojiGuess(roomId, socket.id, questionIndex, guess);
      if (!result) return;
      const { room, allAnswered } = result;

      if (!allAnswered) {
        // 仅自己答完，通知对方
        socket.to(roomId).emit("emoji:opponent-answered", { questionIndex });
        return;
      }

      // 双方都答完，广播揭晓数据（每个玩家视角不同）
      room.players.forEach((p) => {
        const reveal = RoomManager.getEmojiRevealData(room, p.id);
        if (reveal) {
          io.to(p.id).emit("emoji:reveal", reveal);
        }
      });
      // 通知阶段切换到 QUIZ（揭晓）
      io.to(roomId).emit("game:state", {
        phase: room.state.phase,
        currentRound: room.state.currentRound,
      });
    });

    socket.on("emoji:next", ({ roomId }) => {
      const result = RoomManager.nextEmojiQuestion(roomId, socket.id);
      if (!result) return;
      const { room, isLast } = result;

      if (isLast) {
        // 游戏结束
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const overData = RoomManager.getGameOverData(room);
        io.to(roomId).emit("game:over", overData);
      } else {
        // 下一题
        io.to(roomId).emit("game:state", {
          phase: room.state.phase,
          currentRound: room.state.currentRound,
        });
        const q = RoomManager.getCurrentEmojiQuestion(room);
        if (q) {
          io.to(roomId).emit("emoji:question", q);
        }
      }
    });

    socket.on("emoji:restart", ({ roomId }) => {
      const result = RoomManager.restartEmoji(roomId, socket.id);
      if (!result) return;
      const room = result.room;
      io.to(roomId).emit("game:state", {
        phase: room.state.phase,
        currentRound: room.state.currentRound,
      });
      const q = RoomManager.getCurrentEmojiQuestion(room);
      if (q) {
        io.to(roomId).emit("emoji:question", q);
      }
      io.to(roomId).emit("game:config", {
        viewTime: VIEW_TIME,
        drawTime: DRAW_TIME,
        wordDuration: WORD_DURATION,
        totalQuestions: q?.totalQuestions ?? 10,
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
  if (shouldDelete) {
    // 房间已删除，清理合作画画计时器
    stopCoOpTimer(roomId);
  } else if (room) {
    io.to(roomId).emit("room:updated", { room: RoomManager.toRoomView(room) });
    io.to(roomId).emit("player:left", { playerId: socket.id });
  }
}

// ============ 合作画画计时器管理 ============
// 每秒广播剩余时间的 interval
const coOpTimers = new Map<string, ReturnType<typeof setInterval>>();
// AI 评分兜底超时（房主未提交图片时使用默认评分）
const coOpFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 停止合作画画倒计时与兜底计时器 */
function stopCoOpTimer(roomId: string) {
  const t = coOpTimers.get(roomId);
  if (t) {
    clearInterval(t);
    coOpTimers.delete(roomId);
  }
  stopCoOpFallback(roomId);
}

/** 仅停止 AI 评分兜底计时器 */
function stopCoOpFallback(roomId: string) {
  const f = coOpFallbackTimers.get(roomId);
  if (f) {
    clearTimeout(f);
    coOpFallbackTimers.delete(roomId);
  }
}

/**
 * 启动合作画画 90 秒倒计时
 * 每秒广播 coop:time-update；时间到后进入 AI 评分阶段并广播 coop:ai-judging
 * 15 秒内房主未提交画作图则使用默认评分兜底
 */
function startCoOpTimer(io: Io, roomId: string) {
  stopCoOpTimer(roomId);
  const room = RoomManager.getRoom(roomId);
  if (!room) return;
  const timeLimit = RoomManager.getCoOpTimeLimit();
  // 立即下发一次剩余时间
  io.to(roomId).emit("coop:time-update", { timeLeft: timeLimit });

  const interval = setInterval(() => {
    const r = RoomManager.getRoom(roomId);
    if (!r || r.state.phase !== "DRAWING") {
      stopCoOpTimer(roomId);
      return;
    }
    const timeLeft = RoomManager.getCoOpTimeLeft(r);
    io.to(roomId).emit("coop:time-update", { timeLeft });
    if (timeLeft <= 0) {
      // 时间到：进入 AI 评分阶段
      stopCoOpTimer(roomId);
      const timeUpRoom = RoomManager.coOpTimeUp(roomId);
      if (timeUpRoom) {
        io.to(roomId).emit("game:state", {
          phase: timeUpRoom.state.phase,
          currentRound: timeUpRoom.state.currentRound,
        });
        io.to(roomId).emit("coop:ai-judging");
        // 兜底：15 秒内未收到房主提交的图片，使用默认评分
        const fallback = setTimeout(async () => {
          coOpFallbackTimers.delete(roomId);
          const fr = RoomManager.getRoom(roomId);
          if (fr && fr.state.phase === "ROUND_RESULT") {
            // 仍未评分，用空图触发兜底（judgeDrawing 会返回默认 5 分）
            const res = await RoomManager.judgeCoOpDrawing(roomId, "", "");
            if (res) {
              io.to(roomId).emit("game:state", {
                phase: res.room.state.phase,
                currentRound: res.room.state.currentRound,
              });
              io.to(roomId).emit("coop:result", {
                finalImage: "",
                aiScore: res.aiScore,
                aiComment: res.aiComment,
              });
            }
          }
        }, 15000);
        coOpFallbackTimers.set(roomId, fallback);
      }
    }
  }, 1000);
  coOpTimers.set(roomId, interval);
}
