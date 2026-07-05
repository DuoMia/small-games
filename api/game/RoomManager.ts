import type {
  Room,
  Player,
  GameState,
  GamePhase,
  RoomView,
  PlayerView,
  WordEntry,
} from "./types.js";
import { pickRandomWords, generateQuestions, wordBank } from "./WordBank.js";
import { checkAnswer } from "./AnswerChecker.js";
import {
  DEFAULT_DIFFICULTY,
  getDifficultyConfig,
  VALID_DIFFICULTIES,
  type Difficulty,
} from "./difficulty.js";

const TOTAL_ROUNDS = 3;
const MAX_PLAYERS = 2;
// 题量（=词数=答题数）可选值
const VALID_WORD_COUNTS = [15, 30];

class RoomManagerClass {
  private rooms = new Map<string, Room>();

  /**
   * 生成4位房间码（大写字母+数字）
   */
  private generateRoomId(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";
    do {
      id = "";
      for (let i = 0; i < 4; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(id));
    return id;
  }

  /**
   * 创建房间
   */
  createRoom(nickname: string, socketId: string): Room {
    const roomId = this.generateRoomId();
    const player: Player = {
      id: socketId,
      nickname: nickname || "玩家1",
      isReady: false,
      isHost: true,
      totalScore: 0,
      roundScore: 0,
      drawings: [],
      answers: [],
      online: true,
    };
    const room: Room = {
      roomId,
      hostId: socketId,
      players: [player],
      state: this.createInitialState(),
      usedWords: [],
      createdAt: Date.now(),
      wordsPerRound: 15,
      difficulty: DEFAULT_DIFFICULTY,
    };
    this.rooms.set(roomId, room);
    return room;
  }

  /**
   * 加入房间
   */
  joinRoom(roomId: string, nickname: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) return null;
    if (room.players.length >= MAX_PLAYERS) return null;
    // 不允许重复加入
    if (room.players.some((p) => p.id === socketId)) return room;

    const player: Player = {
      id: socketId,
      nickname: nickname || `玩家${room.players.length + 1}`,
      isReady: false,
      isHost: false,
      totalScore: 0,
      roundScore: 0,
      drawings: [],
      answers: [],
      online: true,
    };
    room.players.push(player);
    return room;
  }

  /**
   * 切换准备状态
   */
  toggleReady(roomId: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.state.phase !== "WAITING") return room;
    const player = room.players.find((p) => p.id === socketId);
    if (player) {
      player.isReady = !player.isReady;
    }
    return room;
  }

  /**
   * 设置题量（仅房主、仅 WAITING 阶段）
   */
  setWordsPerRound(roomId: string, socketId: string, count: number): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.state.phase !== "WAITING") return null;
    if (!VALID_WORD_COUNTS.includes(count)) return null;
    if (room.wordsPerRound === count) return room;
    room.wordsPerRound = count;
    return room;
  }

  /**
   * 设置难度（仅房主、仅 WAITING 阶段）
   */
  setDifficulty(roomId: string, socketId: string, difficulty: Difficulty): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.state.phase !== "WAITING") return null;
    if (!VALID_DIFFICULTIES.includes(difficulty)) return null;
    if (room.difficulty === difficulty) return room;
    room.difficulty = difficulty;
    return room;
  }

  /**
   * 开始游戏（房主触发）
   */
  startGame(roomId: string, socketId: string): { room: Room; words: string[] } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.players.length < MAX_PLAYERS) return null;
    if (!room.players.every((p) => p.isReady)) return null;

    this.startNewRound(room, 1);
    return { room, words: room.state.words };
  }

  /**
   * 开始新的一轮
   * 按难度 category 筛选词库，排除已用过的词；词库不足时重置 usedWords
   */
  private startNewRound(room: Room, round: number) {
    const diffConfig = getDifficultyConfig(room.difficulty);
    const wordCount = room.wordsPerRound;

    // 按难度筛选可用词库，判断已用词是否已耗尽该范围
    const filteredBank = diffConfig.categories.length > 0
      ? wordBank.filter((w) => diffConfig.categories.includes(w.category))
      : wordBank;
    // 若该难度下已用词占比超过 70%，重置 usedWords，让玩家重新见到词
    if (room.usedWords.length > 0 && room.usedWords.length >= filteredBank.length * 0.7) {
      room.usedWords = [];
    }

    const wordEntries = pickRandomWords(
      wordCount,
      room.usedWords,
      diffConfig.categories
    );
    // 记录本轮用过的词，避免后续轮次重复
    wordEntries.forEach((w) => room.usedWords.push(w.word));

    room.state = {
      phase: "DRAWING", // 直接进入画图阶段（看词→画图循环在前端完成）
      currentRound: round,
      words: wordEntries.map((w) => w.word),
      wordEntries,
      questions: [],
      currentQuestionIndex: 0,
      stageReady: {},
      drawingUploaded: {},
      answers: {},
      answerResults: {},
      questionNextReady: {},
      revealed: false,
    };
    // 重置玩家本轮状态
    room.players.forEach((p) => {
      p.roundScore = 0;
      p.drawings = [];
      p.answers = [];
    });
  }

  private createInitialState(): GameState {
    return {
      phase: "WAITING",
      currentRound: 0,
      words: [],
      wordEntries: [],
      questions: [],
      currentQuestionIndex: 0,
      stageReady: {},
      drawingUploaded: {},
      answers: {},
      answerResults: {},
      questionNextReady: {},
      revealed: false,
    };
  }

  /**
   * 推进游戏阶段（看词→绘画）
   */
  advanceFromWordDisplay(roomId: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room || room.state.phase !== "WORD_DISPLAY") return null;

    room.state.stageReady[socketId] = true;
    // 双方都准备好后进入绘画阶段
    if (room.players.every((p) => room.state.stageReady[p.id])) {
      room.state.phase = "DRAWING";
      room.state.stageReady = {};
    }
    return room;
  }

  /**
   * 上传画作
   */
  uploadDrawings(
    roomId: string,
    socketId: string,
    drawings: string[]
  ): { room: Room; allUploaded: boolean } | null {
    const room = this.rooms.get(roomId);
    if (!room || room.state.phase !== "DRAWING") return null;

    const player = room.players.find((p) => p.id === socketId);
    if (player) {
      player.drawings = drawings;
    }
    room.state.drawingUploaded[socketId] = true;

    const allUploaded = room.players.every(
      (p) => room.state.drawingUploaded[p.id]
    );

    if (allUploaded) {
      this.startQuiz(room);
    }

    return { room, allUploaded };
  }

  /**
   * 开始答题阶段
   * 题数 = 词数（每个词都答一次），由 room.wordsPerRound 决定
   */
  private startQuiz(room: Room) {
    const wordEntries = room.state.wordEntries;
    room.state.questions = generateQuestions(wordEntries, room.wordsPerRound);
    room.state.phase = "QUIZ";
    room.state.currentQuestionIndex = 0;
    room.state.answers = {};
    room.state.answerResults = {};
    room.state.questionNextReady = {};
    room.state.revealed = false;
  }

  /**
   * 提交答案
   */
  submitAnswer(
    roomId: string,
    socketId: string,
    questionIndex: number,
    answer: string
  ): {
    correct: boolean;
    correctAnswer: string;
    score: number;
    allAnswered: boolean;
    opponentId: string;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room || room.state.phase !== "QUIZ") return null;
    if (questionIndex !== room.state.currentQuestionIndex) return null;

    const question = room.state.questions[questionIndex];
    if (!question) return null;

    const player = room.players.find((p) => p.id === socketId);
    if (!player) return null;

    // 已经答过的不重复计分
    if (room.state.answers[socketId] !== undefined) return null;

    const correct = checkAnswer(answer, question.acceptedAnswers);
    room.state.answers[socketId] = answer;
    room.state.answerResults[socketId] = correct;
    player.answers[questionIndex] = correct;
    if (correct) {
      player.roundScore += 1;
      player.totalScore += 1;
    }

    const opponent = room.players.find((p) => p.id !== socketId);
    const allAnswered = room.players.every(
      (p) => room.state.answers[p.id] !== undefined
    );

    if (allAnswered) {
      room.state.revealed = true;
    }

    return {
      correct,
      correctAnswer: question.correctAnswer,
      score: player.roundScore,
      allAnswered,
      opponentId: opponent?.id || "",
    };
  }

  /**
   * 获取对手答题信息（用于 reveal）
   */
  getOpponentAnswer(roomId: string, socketId: string, questionIndex: number): {
    opponentAnswer: string;
    opponentCorrect: boolean;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const opponent = room.players.find((p) => p.id !== socketId);
    if (!opponent) return null;
    return {
      opponentAnswer: room.state.answers[opponent.id] || "",
      opponentCorrect: room.state.answerResults[opponent.id] || false,
    };
  }

  /**
   * 推进到下一题
   */
  nextQuestion(roomId: string, socketId: string): {
    room: Room;
    isLast: boolean;
    nextIndex: number;
    wordIndex: number;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room || room.state.phase !== "QUIZ") return null;
    if (!room.state.revealed) return null;

    room.state.questionNextReady[socketId] = true;
    const allReady = room.players.every(
      (p) => room.state.questionNextReady[p.id]
    );

    if (!allReady) return null;

    // 检查是否最后一题
    if (room.state.currentQuestionIndex >= room.state.questions.length - 1) {
      // 进入回合结算
      room.state.phase = "ROUND_RESULT";
      return {
        room,
        isLast: true,
        nextIndex: -1,
        wordIndex: -1,
      };
    }

    // 下一题
    room.state.currentQuestionIndex += 1;
    room.state.answers = {};
    room.state.answerResults = {};
    room.state.questionNextReady = {};
    room.state.revealed = false;

    const question = room.state.questions[room.state.currentQuestionIndex];
    return {
      room,
      isLast: false,
      nextIndex: room.state.currentQuestionIndex,
      wordIndex: question.wordIndex,
    };
  }

  /**
   * 进入下一轮
   */
  nextRound(roomId: string, socketId: string): {
    room: Room;
    isGameOver: boolean;
    words: string[];
  } | null {
    const room = this.rooms.get(roomId);
    if (!room || room.state.phase !== "ROUND_RESULT") return null;
    if (room.hostId !== socketId) return null;

    if (room.state.currentRound >= TOTAL_ROUNDS) {
      // 游戏结束
      room.state.phase = "GAME_OVER";
      return { room, isGameOver: true, words: [] };
    }

    this.startNewRound(room, room.state.currentRound + 1);
    return { room, isGameOver: false, words: room.state.words };
  }

  /**
   * 再玩一局
   * 不清空 usedWords，让连续多局也不重复（startNewRound 内部会在词库快耗尽时自动重置）
   */
  restartGame(roomId: string, socketId: string): { room: Room; words: string[] } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;

    // 重置玩家分数
    room.players.forEach((p) => {
      p.totalScore = 0;
      p.roundScore = 0;
      p.drawings = [];
      p.answers = [];
      p.isReady = false;
    });
    // 注意：不清空 usedWords，避免再玩一局时题目重复
    // startNewRound 内部会判断词库是否快耗尽，自动重置

    this.startNewRound(room, 1);
    return { room, words: room.state.words };
  }

  /**
   * 离开房间
   */
  leaveRoom(roomId: string, socketId: string): { room: Room | null; shouldDelete: boolean } {
    const room = this.rooms.get(roomId);
    if (!room) return { room: null, shouldDelete: false };

    const playerIdx = room.players.findIndex((p) => p.id === socketId);
    if (playerIdx === -1) return { room, shouldDelete: false };

    room.players.splice(playerIdx, 1);

    // 房间空了，删除
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      return { room: null, shouldDelete: true };
    }

    // 转移房主
    if (room.hostId === socketId) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }

    return { room, shouldDelete: false };
  }

  /**
   * 标记玩家离线（断线但未主动离开）
   */
  setPlayerOffline(socketId: string): { roomId: string; room: Room | null } | null {
    for (const [roomId, room] of this.rooms) {
      const player = room.players.find((p) => p.id === socketId);
      if (player) {
        player.online = false;
        return { roomId, room };
      }
    }
    return null;
  }

  getRoom(roomId: string): Room | null {
    return this.rooms.get(roomId) || null;
  }

  /**
   * 转换为客户端视图（不含敏感数据）
   */
  toRoomView(room: Room): RoomView {
    return {
      roomId: room.roomId,
      hostId: room.hostId,
      players: room.players.map((p) => this.toPlayerView(p)),
      phase: room.state.phase,
      currentRound: room.state.currentRound,
      wordsPerRound: room.wordsPerRound,
      difficulty: room.difficulty,
    };
  }

  toPlayerView(player: Player): PlayerView {
    return {
      id: player.id,
      nickname: player.nickname,
      isReady: player.isReady,
      isHost: player.isHost,
      totalScore: player.totalScore,
      roundScore: player.roundScore,
      online: player.online,
    };
  }

  /**
   * 获取终局结果
   */
  getGameOverData(room: Room): {
    finalScores: PlayerView[];
    winnerId: string | null;
  } {
    const finalScores = room.players.map((p) => this.toPlayerView(p));
    const maxScore = Math.max(...finalScores.map((p) => p.totalScore));
    const winners = finalScores.filter((p) => p.totalScore === maxScore);
    const winnerId = winners.length === 1 ? winners[0].id : null;
    return { finalScores, winnerId };
  }

  /**
   * 获取回合结算数据（含画作）
   */
  getRoundResultData(room: Room): {
    scores: PlayerView[];
    drawings: Record<string, string[]>;
  } {
    return {
      scores: room.players.map((p) => this.toPlayerView(p)),
      drawings: Object.fromEntries(
        room.players.map((p) => [p.id, p.drawings])
      ),
    };
  }

  getWordsForRound(room: Room): WordEntry[] {
    return room.state.wordEntries;
  }

  getQuestions(room: Room) {
    return room.state.questions;
  }
}

export const RoomManager = new RoomManagerClass();
