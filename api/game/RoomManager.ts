import type {
  Room,
  Player,
  GameState,
  GamePhase,
  RoomView,
  PlayerView,
  WordEntry,
  GameType,
  TelepathyQuestion,
  CoOpStroke,
  EmojiPuzzle,
} from "./types.js";
import { pickRandomWords, generateQuestions, wordBank } from "./WordBank.js";
import { checkAnswer } from "./AnswerChecker.js";
import {
  DEFAULT_DIFFICULTY,
  getDifficultyConfig,
  VALID_DIFFICULTIES,
  type Difficulty,
} from "./difficulty.js";
// 默契考验题包数据
import telepathyPacks from "../data/telepathy-questions.json";
// 海龟汤题库
import turtleSoups from "../data/turtle-soup.json";
// 合作画画命题题库
import drawingPrompts from "../data/drawing-prompts.json";
// 表情包猜词题库
import emojiPuzzlesData from "../data/emoji-puzzles.json";
import { judgeQuestion, judgeGuess, judgeDrawing } from "../ai/judge.js";

const TOTAL_ROUNDS = 3;
const MAX_PLAYERS = 2;
// 题量（=词数=答题数）可选值
const VALID_WORD_COUNTS = [15, 30];
// 默契考验总题数
const TELEPATHY_TOTAL_QUESTIONS = 10;
// 默契考验默认题包
const DEFAULT_TELEPATHY_PACK = "life";
// 海龟汤最大提问次数
const TURTLE_MAX_QUESTIONS = 20;
// 海龟汤默认难度
const DEFAULT_TURTLE_DIFFICULTY = "any";
// 合作画画总时长（秒），双方同时画
const CO_OP_TIME_LIMIT = 90;
// 表情包猜词总题数
const EMOJI_TOTAL_QUESTIONS = 10;
// 表情包猜词每题限时（秒）
const EMOJI_TIME_LIMIT = 30;
// 表情包猜词答对得分
const EMOJI_CORRECT_SCORE = 10;

// 题包数据结构
interface TelepathyPack {
  id: string;
  name: string;
  icon: string;
  color: string;
  questions: TelepathyQuestion[];
}

// 海龟汤题库结构
interface TurtleSoupEntry {
  id: string;
  title: string;
  difficulty: string; // easy/medium/hard
  category: string;
  surface: string;
  truth: string;
  keywords: string[];
}

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
  createRoom(nickname: string, socketId: string, gameType: GameType = "draw-memory"): Room {
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
      gameType,
      telepathyPackId: gameType === "telepathy" ? DEFAULT_TELEPATHY_PACK : undefined,
      turtleDifficulty: gameType === "turtle-soup" ? DEFAULT_TURTLE_DIFFICULTY : undefined,
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
   * 根据 gameType 路由到对应游戏
   */
  startGame(roomId: string, socketId: string): { room: Room; words: string[] } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.players.length < MAX_PLAYERS) return null;
    if (!room.players.every((p) => p.isReady)) return null;

    if (room.gameType === "telepathy") {
      // 默契考验：进入"选择"阶段（复用 DRAWING）
      this.startTelepathy(room);
      return { room, words: [] };
    }

    if (room.gameType === "turtle-soup") {
      // 海龟汤：抽取汤面，进入 DRAWING（游戏中）
      this.startTurtleSoupInternal(room);
      return { room, words: [] };
    }

    if (room.gameType === "co-op-drawing") {
      // 合作画画：随机抽命题，初始化 GameState
      this.startCoOpDrawingInternal(room);
      return { room, words: [] };
    }

    if (room.gameType === "emoji-guessing") {
      // 表情包猜词：随机抽10题，初始化 GameState
      this.startEmojiGuessingInternal(room);
      return { room, words: [] };
    }

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

    if (room.gameType === "telepathy") {
      this.startTelepathy(room);
      return { room, words: [] };
    }

    if (room.gameType === "turtle-soup") {
      this.startTurtleSoupInternal(room);
      return { room, words: [] };
    }

    if (room.gameType === "co-op-drawing") {
      this.startCoOpDrawingInternal(room);
      return { room, words: [] };
    }

    if (room.gameType === "emoji-guessing") {
      this.restartEmoji(roomId, socketId);
      return { room, words: [] };
    }

    this.startNewRound(room, 1);
    return { room, words: room.state.words };
  }

  // ============ 默契考验（心灵感应）相关 ============

  /**
   * 设置默契考验题包（仅房主、仅 WAITING 阶段）
   */
  setTelepathyPack(roomId: string, socketId: string, packId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.state.phase !== "WAITING") return null;
    if (room.gameType !== "telepathy") return null;
    // 校验 packId 合法
    const pack = (telepathyPacks as TelepathyPack[]).find((p) => p.id === packId);
    if (!pack) return null;
    if (room.telepathyPackId === packId) return room;
    room.telepathyPackId = packId;
    return room;
  }

  /**
   * 从题包中随机抽取指定数量的题目（Fisher-Yates 洗牌）
   */
  private pickTelepathyQuestions(pack: TelepathyPack, count: number): TelepathyQuestion[] {
    const all = [...pack.questions];
    // 洗牌
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, Math.min(count, all.length));
  }

  /**
   * 开始默契考验：进入选择阶段（复用 DRAWING）
   */
  private startTelepathy(room: Room) {
    const packId = room.telepathyPackId || DEFAULT_TELEPATHY_PACK;
    const pack = (telepathyPacks as TelepathyPack[]).find((p) => p.id === packId)
      || (telepathyPacks as TelepathyPack[])[0];
    const questions = this.pickTelepathyQuestions(pack, TELEPATHY_TOTAL_QUESTIONS);

    // 重置玩家分数
    room.players.forEach((p) => {
      p.totalScore = 0;
      p.roundScore = 0;
      p.drawings = [];
      p.answers = [];
    });

    room.state = {
      phase: "DRAWING", // 复用 DRAWING 作为"选择中"阶段
      currentRound: 1,
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
      telepathyQuestions: questions,
      currentTelepathyIndex: 0,
      telepathyChoices: {},
      telepathyScores: {},
      telepathyRevealed: false,
    };
  }

  /**
   * 获取当前默契考验题目数据
   */
  getCurrentTelepathyQuestion(room: Room): {
    questionIndex: number;
    question: string;
    options: string[];
    totalQuestions: number;
  } | null {
    if (!room.state.telepathyQuestions) return null;
    const idx = room.state.currentTelepathyIndex ?? 0;
    const q = room.state.telepathyQuestions[idx];
    if (!q) return null;
    return {
      questionIndex: idx,
      question: q.question,
      options: q.options,
      totalQuestions: room.state.telepathyQuestions.length,
    };
  }

  /**
   * 提交默契考验选择
   * 返回 null 表示参数错误；返回对象表示本次提交结果
   * - allChosen=false：仅自己选了，需要通知对方
   * - allChosen=true：双方都选完，需揭晓
   */
  submitTelepathyChoice(
    roomId: string,
    socketId: string,
    questionIndex: number,
    choice: number
  ): {
    room: Room;
    allChosen: boolean;
    opponentId: string;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "telepathy") return null;
    if (room.state.phase !== "DRAWING") return null; // 选择阶段
    if (questionIndex !== (room.state.currentTelepathyIndex ?? 0)) return null;

    const player = room.players.find((p) => p.id === socketId);
    if (!player) return null;

    const choices = room.state.telepathyChoices || {};
    // 已经选过的不重复处理
    if (choices[socketId] !== undefined) return null;

    // 校验 choice 在选项范围内，超界默认为最后一个（即 E）
    const q = room.state.telepathyQuestions?.[questionIndex];
    if (!q) return null;
    const safeChoice = choice >= 0 && choice < q.options.length ? choice : q.options.length - 1;

    choices[socketId] = safeChoice;
    room.state.telepathyChoices = choices;

    const opponent = room.players.find((p) => p.id !== socketId);
    const allChosen = room.players.every(
      (p) => room.state.telepathyChoices![p.id] !== undefined
    );

    if (allChosen) {
      // 双方都选完，计算分数并揭晓
      this.resolveTelepathyRound(room);
    }

    return {
      room,
      allChosen,
      opponentId: opponent?.id || "",
    };
  }

  /**
   * 计算默契考验单题得分并累加到玩家总分
   * 计分规则：相同 +10；相邻 +5；其他 +0
   */
  private resolveTelepathyRound(room: Room) {
    const choices = room.state.telepathyChoices || {};
    const [a, b] = room.players;
    if (!a || !b) return;
    const ca = choices[a.id];
    const cb = choices[b.id];
    if (ca === undefined || cb === undefined) return;

    const diff = Math.abs(ca - cb);
    let scoreA = 0;
    let scoreB = 0;
    if (diff === 0) {
      // 完全一致，双方都 +10
      scoreA = 10;
      scoreB = 10;
    } else if (diff === 1) {
      // 相邻，双方都 +5
      scoreA = 5;
      scoreB = 5;
    }
    a.totalScore += scoreA;
    b.totalScore += scoreB;
    room.state.telepathyScores = {
      [a.id]: scoreA,
      [b.id]: scoreB,
    };
    room.state.telepathyRevealed = true;
    // 进入揭晓阶段（复用 QUIZ）
    room.state.phase = "QUIZ";
  }

  /**
   * 获取默契考验揭晓数据（针对每个玩家视角）
   */
  getTelepathyRevealData(room: Room, socketId: string): {
    questionIndex: number;
    myChoice: number;
    opponentChoice: number;
    myScore: number;
    opponentScore: number;
    match: "full" | "partial" | "none";
  } | null {
    if (!room.state.telepathyRevealed) return null;
    const choices = room.state.telepathyChoices || {};
    const scores = room.state.telepathyScores || {};
    const opponent = room.players.find((p) => p.id !== socketId);
    if (!opponent) return null;
    const myChoice = choices[socketId] ?? 0;
    const opponentChoice = choices[opponent.id] ?? 0;
    const myScore = scores[socketId] ?? 0;
    const opponentScore = scores[opponent.id] ?? 0;
    const diff = Math.abs(myChoice - opponentChoice);
    const match: "full" | "partial" | "none" =
      diff === 0 ? "full" : diff === 1 ? "partial" : "none";
    return {
      questionIndex: room.state.currentTelepathyIndex ?? 0,
      myChoice,
      opponentChoice,
      myScore,
      opponentScore,
      match,
    };
  }

  /**
   * 推进到下一道默契考验题
   * 最后一题则进入 GAME_OVER
   */
  nextTelepathyQuestion(roomId: string, socketId: string): {
    room: Room;
    isLast: boolean;
    nextIndex: number;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "telepathy") return null;
    if (room.state.phase !== "QUIZ") return null;
    if (!room.state.telepathyRevealed) return null;

    // 简单起见：任意一方点"下一题"即推进（房主优先，避免双方都需点击）
    // 这里允许任意玩家推进
    const total = room.state.telepathyQuestions?.length ?? 0;
    const cur = room.state.currentTelepathyIndex ?? 0;

    if (cur >= total - 1) {
      // 最后一题，游戏结束
      room.state.phase = "GAME_OVER";
      return { room, isLast: true, nextIndex: -1 };
    }

    const nextIndex = cur + 1;
    room.state.currentTelepathyIndex = nextIndex;
    room.state.telepathyChoices = {};
    room.state.telepathyScores = {};
    room.state.telepathyRevealed = false;
    // 回到选择阶段
    room.state.phase = "DRAWING";
    return { room, isLast: false, nextIndex };
  }

  /**
   * 重玩默契考验
   */
  restartTelepathy(roomId: string, socketId: string): { room: Room } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.gameType !== "telepathy") return null;

    this.startTelepathy(room);
    return { room };
  }

  // ============ 海龟汤相关 ============

  /**
   * 设置海龟汤难度（仅房主、仅 WAITING 阶段）
   */
  setTurtleDifficulty(roomId: string, socketId: string, difficulty: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.state.phase !== "WAITING") return null;
    if (room.gameType !== "turtle-soup") return null;
    const valid = ["any", "easy", "medium", "hard"];
    if (!valid.includes(difficulty)) return null;
    if (room.turtleDifficulty === difficulty) return room;
    room.turtleDifficulty = difficulty;
    return room;
  }

  /**
   * 按难度筛选随机抽取一个汤面
   * 同一局内避免重复（用 usedWords 临时记 id）
   */
  private pickTurtleSoup(room: Room): TurtleSoupEntry {
    const diff = room.turtleDifficulty || DEFAULT_TURTLE_DIFFICULTY;
    const pool = (turtleSoups as TurtleSoupEntry[]).filter(
      (s) => diff === "any" || s.difficulty === diff
    );
    // 排除本局已用过的汤面 id（记在 usedWords 里）
    const available = pool.filter((s) => !room.usedWords.includes(s.id));
    // 池子空了就重置 usedWords 中海龟汤 id 部分
    const list = available.length > 0 ? available : pool;
    const pick = list[Math.floor(Math.random() * list.length)];
    // 记录已用 id（与画词 usedWords 共用，避免类型复杂化）
    room.usedWords.push(pick.id);
    return pick;
  }

  /**
   * 内部启动海龟汤（开始或重玩都走这里）
   */
  private startTurtleSoupInternal(room: Room) {
    const soup = this.pickTurtleSoup(room);

    // 重置玩家分数
    room.players.forEach((p) => {
      p.totalScore = 0;
      p.roundScore = 0;
      p.drawings = [];
      p.answers = [];
    });

    room.state = {
      phase: "DRAWING", // 复用 DRAWING 作为"游戏中"
      currentRound: 1,
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
      // 海龟汤字段
      turtleSoupId: soup.id,
      turtleSoupSurface: soup.surface,
      turtleSoupTruth: soup.truth,
      turtleSoupKeywords: soup.keywords,
      turtleSoupCategory: soup.category,
      turtleQuestions: [],
      turtleGuesses: [],
      turtleQuestionsLeft: TURTLE_MAX_QUESTIONS,
      turtleResolved: false,
    };
  }

  /**
   * 开始海龟汤游戏（房主触发）
   */
  startTurtleSoup(roomId: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.gameType !== "turtle-soup") return null;
    this.startTurtleSoupInternal(room);
    return room;
  }

  /**
   * 获取当前汤面信息（不含 truth）
   */
  getCurrentTurtleSurface(room: Room): {
    soupId: string;
    surface: string;
    difficulty: string;
    category: string;
    questionsLeft: number;
  } | null {
    if (!room.state.turtleSoupId || !room.state.turtleSoupSurface) return null;
    return {
      soupId: room.state.turtleSoupId,
      surface: room.state.turtleSoupSurface,
      difficulty: room.turtleDifficulty || DEFAULT_TURTLE_DIFFICULTY,
      category: room.state.turtleSoupCategory || "",
      questionsLeft: room.state.turtleQuestionsLeft ?? TURTLE_MAX_QUESTIONS,
    };
  }

  /**
   * 提问：记录问题并调用 AI 判断
   * 返回 { ok, answer, questionsLeft } 或 { error }
   */
  async askTurtleQuestion(
    roomId: string,
    socketId: string,
    question: string
  ): Promise<
    | { ok: true; questionIndex: number; question: string; asker: string; answer: "是" | "否" | "无关"; questionsLeft: number; exhausted: boolean }
    | { ok: false; error: string }
  > {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: "房间不存在" };
    if (room.gameType !== "turtle-soup") return { ok: false, error: "非海龟汤房间" };
    if (room.state.phase !== "DRAWING") return { ok: false, error: "当前不可提问" };
    if (room.state.turtleResolved) return { ok: false, error: "已揭晓，不可提问" };
    const player = room.players.find((p) => p.id === socketId);
    if (!player) return { ok: false, error: "玩家不存在" };
    const q = question.trim();
    if (!q) return { ok: false, error: "提问不能为空" };
    if ((room.state.turtleQuestionsLeft ?? 0) <= 0) return { ok: false, error: "提问次数已用完" };

    const truth = room.state.turtleSoupTruth || "";
    const keywords = room.state.turtleSoupKeywords || [];
    const answer = await judgeQuestion(q, truth, keywords);

    const questions = room.state.turtleQuestions || [];
    const questionIndex = questions.length;
    questions.push({ question: q, asker: player.nickname, answer });
    room.state.turtleQuestions = questions;
    room.state.turtleQuestionsLeft = (room.state.turtleQuestionsLeft ?? TURTLE_MAX_QUESTIONS) - 1;
    const questionsLeft = room.state.turtleQuestionsLeft;

    // 用完 20 问未猜中，自动失败
    const exhausted = questionsLeft <= 0;
    if (exhausted) {
      room.state.turtleResolved = true;
      room.state.phase = "GAME_OVER";
    }

    return {
      ok: true,
      questionIndex,
      question: q,
      asker: player.nickname,
      answer,
      questionsLeft,
      exhausted,
    };
  }

  /**
   * 猜测汤底：调用 AI 判断
   */
  async guessTurtleAnswer(
    roomId: string,
    socketId: string,
    guess: string
  ): Promise<
    | { ok: true; guessIndex: number; guess: string; guesser: string; correct: boolean; close: boolean; feedback: string }
    | { ok: false; error: string }
  > {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: "房间不存在" };
    if (room.gameType !== "turtle-soup") return { ok: false, error: "非海龟汤房间" };
    if (room.state.phase !== "DRAWING") return { ok: false, error: "当前不可猜测" };
    if (room.state.turtleResolved) return { ok: false, error: "已揭晓" };
    const player = room.players.find((p) => p.id === socketId);
    if (!player) return { ok: false, error: "玩家不存在" };
    const g = guess.trim();
    if (!g) return { ok: false, error: "猜测不能为空" };

    const truth = room.state.turtleSoupTruth || "";
    const keywords = room.state.turtleSoupKeywords || [];
    const result = await judgeGuess(g, truth, keywords);

    const guesses = room.state.turtleGuesses || [];
    const guessIndex = guesses.length;
    guesses.push({
      guess: g,
      guesser: player.nickname,
      correct: result.correct,
      close: result.close,
      feedback: result.feedback,
    });
    room.state.turtleGuesses = guesses;

    if (result.correct) {
      room.state.turtleResolved = true;
      room.state.phase = "GAME_OVER";
    }

    return {
      ok: true,
      guessIndex,
      guess: g,
      guesser: player.nickname,
      correct: result.correct,
      close: result.close,
      feedback: result.feedback,
    };
  }

  /**
   * 重玩海龟汤（换一个汤面）
   */
  restartTurtle(roomId: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.gameType !== "turtle-soup") return null;
    this.startTurtleSoupInternal(room);
    return room;
  }

  /**
   * 获取海龟汤真相（揭晓用）
   */
  getTurtleTruth(room: Room): string {
    return room.state.turtleSoupTruth || "";
  }

  // ============ 合作画画（接龙画）相关 ============

  /**
   * 随机抽取一个合作画画命题
   */
  private pickCoOpPrompt(): string {
    const prompts = drawingPrompts as string[];
    return prompts[Math.floor(Math.random() * prompts.length)] || "会飞的猪";
  }

  /**
   * 内部启动合作画画（开始或重玩都走这里）
   * 随机抽命题，初始化 GameState，双方同时画（不再轮流）
   * 保留已设置的横竖屏方向，默认横屏
   */
  private startCoOpDrawingInternal(room: Room) {
    const prompt = this.pickCoOpPrompt();

    // 重置玩家分数
    room.players.forEach((p) => {
      p.totalScore = 0;
      p.roundScore = 0;
      p.drawings = [];
      p.answers = [];
    });

    // 保留已设置的横竖屏方向，默认横屏
    const orientation = room.state.coOpOrientation || "landscape";

    room.state = {
      phase: "DRAWING",
      currentRound: 1,
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
      // 合作画画字段（同时画 + AI 评分）
      coOpPrompt: prompt,
      coOpStrokes: [],
      coOpCurrentStroke: null,
      coOpOrientation: orientation,
      coOpAIScore: undefined,
      coOpAIComment: undefined,
      coOpStartTime: Date.now(),
    };
  }

  /**
   * 开始合作画画游戏（房主触发）
   */
  startCoOpDrawing(roomId: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.gameType !== "co-op-drawing") return null;
    this.startCoOpDrawingInternal(room);
    return room;
  }

  /**
   * 设置合作画画画布方向（仅房主、仅 WAITING 阶段）
   */
  setCoOpOrientation(
    roomId: string,
    socketId: string,
    orientation: "landscape" | "portrait"
  ): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.state.phase !== "WAITING") return null;
    if (room.gameType !== "co-op-drawing") return null;
    if (room.state.coOpOrientation === orientation) return room;
    room.state.coOpOrientation = orientation;
    return room;
  }

  /**
   * 获取合作画画当前方向
   */
  getCoOpOrientation(room: Room): "landscape" | "portrait" {
    return room.state.coOpOrientation || "landscape";
  }

  /**
   * 获取合作画画剩余时间（秒）
   */
  getCoOpTimeLeft(room: Room): number {
    if (!room.state.coOpStartTime) return CO_OP_TIME_LIMIT;
    const elapsed = (Date.now() - room.state.coOpStartTime) / 1000;
    return Math.max(0, Math.ceil(CO_OP_TIME_LIMIT - elapsed));
  }

  /**
   * 合作画画总时长（秒），供外部计时器使用
   */
  getCoOpTimeLimit(): number {
    return CO_OP_TIME_LIMIT;
  }

  /**
   * 开始一笔：同时画模式下不检查 currentPlayer，任何玩家都可画
   * 返回完整笔画（含 author）用于广播给对方
   */
  coOpStrokeStart(
    roomId: string,
    socketId: string,
    stroke: Omit<CoOpStroke, "author">
  ): { room: Room; fullStroke: CoOpStroke } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "co-op-drawing") return null;
    if (room.state.phase !== "DRAWING") return null;

    const fullStroke: CoOpStroke = {
      ...stroke,
      author: socketId,
    };
    // 追踪当前笔画（同时画时为 last writer wins，仅作记录用）
    room.state.coOpCurrentStroke = fullStroke;
    return { room, fullStroke };
  }

  /**
   * 笔画进行中：转发点（同时画，任意玩家可发）
   */
  coOpStrokePoint(
    roomId: string,
    socketId: string,
    point: { x: number; y: number }
  ): { room: Room } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "co-op-drawing") return null;
    if (room.state.phase !== "DRAWING") return null;
    // 追踪用：仅追加到属于该作者的当前笔画
    const cur = room.state.coOpCurrentStroke;
    if (cur && cur.author === socketId) {
      cur.points.push(point);
    }
    return { room };
  }

  /**
   * 结束一笔：把完整笔画追加到 coOpStrokes（同时画，任意玩家可结束自己的笔画）
   * stroke 由前端提交完整笔画数据
   */
  coOpStrokeEnd(
    roomId: string,
    socketId: string,
    stroke: CoOpStroke
  ): { room: Room } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "co-op-drawing") return null;
    if (room.state.phase !== "DRAWING") return null;

    // 把完成的笔画追加到已完成列表
    const strokes = room.state.coOpStrokes || [];
    strokes.push(stroke);
    room.state.coOpStrokes = strokes;
    // 清除追踪（若属于同一作者）
    const cur = room.state.coOpCurrentStroke;
    if (cur && cur.author === socketId) {
      room.state.coOpCurrentStroke = null;
    }
    return { room };
  }

  /**
   * 时间到：进入 AI 评分阶段（ROUND_RESULT）
   */
  coOpTimeUp(roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "co-op-drawing") return null;
    if (room.state.phase !== "DRAWING") return null;
    room.state.phase = "ROUND_RESULT";
    return room;
  }

  /**
   * 接收前端提交的画作图片，调用 AI 评分
   * 仅在 ROUND_RESULT 阶段接受，且只接受一次
   * 评分完成后进入 GAME_OVER
   */
  async judgeCoOpDrawing(
    roomId: string,
    socketId: string,
    image: string
  ): Promise<{ room: Room; aiScore: number; aiComment: string } | null> {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "co-op-drawing") return null;
    if (room.state.phase !== "ROUND_RESULT") return null;
    // 只接受一次评分
    if (room.state.coOpAIScore !== undefined) return null;

    const prompt = room.state.coOpPrompt || "";
    const result = await judgeDrawing(image, prompt);
    room.state.coOpAIScore = result.score;
    room.state.coOpAIComment = result.comment;
    room.state.phase = "GAME_OVER";
    return { room, aiScore: result.score, aiComment: result.comment };
  }

  /**
   * 重玩合作画画（换命题）
   */
  restartCoOp(roomId: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.gameType !== "co-op-drawing") return null;
    this.startCoOpDrawingInternal(room);
    return room;
  }

  /**
   * 获取合作画画结果数据（用于 GAME_OVER 展示）
   * finalImage 由前端根据 coOpStrokes 渲染（后端无 canvas 环境）
   */
  getCoOpResultData(room: Room): {
    finalImage: string;
    aiScore: number;
    aiComment: string;
  } | null {
    if (!room.state.coOpPrompt) return null;
    return {
      finalImage: "", // 前端根据 strokes 渲染
      aiScore: room.state.coOpAIScore ?? 0,
      aiComment: room.state.coOpAIComment ?? "",
    };
  }

  /**
   * 获取合作画画所有笔画（用于结果展示）
   */
  getCoOpStrokes(room: Room): CoOpStroke[] {
    return room.state.coOpStrokes || [];
  }

  // ============ 表情包猜词相关 ============

  /**
   * 标准化字符串：小写 + 去除所有空白
   * 用于答案匹配（不区分大小写、忽略空格）
   */
  private normalizeEmojiAnswer(str: string): string {
    return (str || "").toLowerCase().replace(/\s+/g, "").trim();
  }

  /**
   * 判断猜测是否正确：匹配 answer 或 alternatives 中任一项（已标准化）
   */
  private checkEmojiGuess(guess: string, puzzle: EmojiPuzzle): boolean {
    const g = this.normalizeEmojiAnswer(guess);
    if (!g) return false;
    const accepted = [puzzle.answer, ...(puzzle.alternatives || [])];
    return accepted.some((a) => this.normalizeEmojiAnswer(a) === g);
  }

  /**
   * 从题库随机抽取指定数量的题目（Fisher-Yates 洗牌）
   */
  private pickEmojiPuzzles(count: number): EmojiPuzzle[] {
    const all = (emojiPuzzlesData as EmojiPuzzle[]).slice();
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, Math.min(count, all.length));
  }

  /**
   * 内部启动表情包猜词（开始或重玩都走这里）
   * 随机选10题，初始化所有 emoji 字段，phase=DRAWING，currentEmojiIndex=0
   */
  private startEmojiGuessingInternal(room: Room) {
    const puzzles = this.pickEmojiPuzzles(EMOJI_TOTAL_QUESTIONS);

    // 重置玩家分数
    room.players.forEach((p) => {
      p.totalScore = 0;
      p.roundScore = 0;
      p.drawings = [];
      p.answers = [];
    });

    // 初始化双方累计总分
    const totalScores: Record<string, number> = {};
    room.players.forEach((p) => {
      totalScores[p.id] = 0;
    });

    room.state = {
      phase: "DRAWING", // 复用 DRAWING 作为"答题中"
      currentRound: 1,
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
      // 表情包猜词字段
      emojiPuzzles: puzzles,
      currentEmojiIndex: 0,
      emojiGuesses: {},
      emojiResults: {},
      emojiScores: {},
      emojiRevealed: false,
      emojiTotalScores: totalScores,
    };
  }

  /**
   * 开始表情包猜词游戏（房主触发）
   */
  startEmojiGuessing(roomId: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.gameType !== "emoji-guessing") return null;
    this.startEmojiGuessingInternal(room);
    return room;
  }

  /**
   * 获取当前表情包猜词题目数据（不含 answer/alternatives）
   */
  getCurrentEmojiQuestion(room: Room): {
    questionIndex: number;
    emoji: string;
    category: string;
    totalQuestions: number;
    timeLimit: number;
  } | null {
    if (!room.state.emojiPuzzles) return null;
    const idx = room.state.currentEmojiIndex ?? 0;
    const q = room.state.emojiPuzzles[idx];
    if (!q) return null;
    return {
      questionIndex: idx,
      emoji: q.emoji,
      category: q.category,
      totalQuestions: room.state.emojiPuzzles.length,
      timeLimit: EMOJI_TIME_LIMIT,
    };
  }

  /**
   * 提交表情包猜词猜测
   * - 两人都答完：判断对错、计算得分、更新总分、广播 emoji:reveal、phase=QUIZ
   * - 仅一人答完：广播 emoji:opponent-answered 给对方
   */
  submitEmojiGuess(
    roomId: string,
    socketId: string,
    questionIndex: number,
    guess: string
  ): {
    room: Room;
    allAnswered: boolean;
    opponentId: string;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "emoji-guessing") return null;
    if (room.state.phase !== "DRAWING") return null; // 答题阶段
    if (questionIndex !== (room.state.currentEmojiIndex ?? 0)) return null;

    const player = room.players.find((p) => p.id === socketId);
    if (!player) return null;

    const guesses = room.state.emojiGuesses || {};
    // 已经答过的不重复处理
    if (guesses[socketId] !== undefined) return null;

    guesses[socketId] = guess;
    room.state.emojiGuesses = guesses;

    const opponent = room.players.find((p) => p.id !== socketId);
    const allAnswered = room.players.every(
      (p) => room.state.emojiGuesses![p.id] !== undefined
    );

    if (allAnswered) {
      // 双方都答完，揭晓
      this.resolveEmojiRound(room);
    }

    return {
      room,
      allAnswered,
      opponentId: opponent?.id || "",
    };
  }

  /**
   * 计算表情包猜词单题得分并累加到总分
   * 计分规则：答对 +10，答错 +0
   */
  private resolveEmojiRound(room: Room) {
    const guesses = room.state.emojiGuesses || {};
    const idx = room.state.currentEmojiIndex ?? 0;
    const puzzle = room.state.emojiPuzzles?.[idx];
    if (!puzzle) return;

    const results: Record<string, boolean> = {};
    const scores: Record<string, number> = {};
    const totalScores = room.state.emojiTotalScores || {};

    room.players.forEach((p) => {
      const guess = guesses[p.id] || "";
      const correct = this.checkEmojiGuess(guess, puzzle);
      const score = correct ? EMOJI_CORRECT_SCORE : 0;
      results[p.id] = correct;
      scores[p.id] = score;
      totalScores[p.id] = (totalScores[p.id] || 0) + score;
    });

    room.state.emojiResults = results;
    room.state.emojiScores = scores;
    room.state.emojiTotalScores = totalScores;
    room.state.emojiRevealed = true;
    // 进入揭晓阶段（复用 QUIZ）
    room.state.phase = "QUIZ";
  }

  /**
   * 获取表情包猜词揭晓数据（针对每个玩家视角）
   */
  getEmojiRevealData(room: Room, socketId: string): {
    questionIndex: number;
    myGuess: string;
    opponentGuess: string;
    answer: string;
    myCorrect: boolean;
    opponentCorrect: boolean;
    myScore: number;
    opponentScore: number;
    myTotal: number;
    opponentTotal: number;
  } | null {
    if (!room.state.emojiRevealed) return null;
    const idx = room.state.currentEmojiIndex ?? 0;
    const puzzle = room.state.emojiPuzzles?.[idx];
    if (!puzzle) return null;
    const guesses = room.state.emojiGuesses || {};
    const results = room.state.emojiResults || {};
    const scores = room.state.emojiScores || {};
    const totalScores = room.state.emojiTotalScores || {};
    const opponent = room.players.find((p) => p.id !== socketId);
    if (!opponent) return null;
    return {
      questionIndex: idx,
      myGuess: guesses[socketId] || "",
      opponentGuess: guesses[opponent.id] || "",
      answer: puzzle.answer,
      myCorrect: results[socketId] || false,
      opponentCorrect: results[opponent.id] || false,
      myScore: scores[socketId] || 0,
      opponentScore: scores[opponent.id] || 0,
      myTotal: totalScores[socketId] || 0,
      opponentTotal: totalScores[opponent.id] || 0,
    };
  }

  /**
   * 推进到下一道表情包猜词题
   * 最后一题则进入 GAME_OVER 并同步玩家 totalScore 用于终局排名
   */
  nextEmojiQuestion(roomId: string, socketId: string): {
    room: Room;
    isLast: boolean;
    nextIndex: number;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "emoji-guessing") return null;
    if (room.state.phase !== "QUIZ") return null;
    if (!room.state.emojiRevealed) return null;

    const total = room.state.emojiPuzzles?.length ?? 0;
    const cur = room.state.currentEmojiIndex ?? 0;

    if (cur >= total - 1) {
      // 最后一题：把累计总分同步到玩家 totalScore，用于 getGameOverData 排名
      const totalScores = room.state.emojiTotalScores || {};
      room.players.forEach((p) => {
        p.totalScore = totalScores[p.id] || 0;
      });
      room.state.phase = "GAME_OVER";
      return { room, isLast: true, nextIndex: -1 };
    }

    const nextIndex = cur + 1;
    room.state.currentEmojiIndex = nextIndex;
    room.state.emojiGuesses = {};
    room.state.emojiResults = {};
    room.state.emojiScores = {};
    room.state.emojiRevealed = false;
    // 回到答题阶段
    room.state.phase = "DRAWING";
    return { room, isLast: false, nextIndex };
  }

  /**
   * 重玩表情包猜词（重新抽题）
   * 保留 usedWords（与表情包题库无关，但保持一致性）
   */
  restartEmoji(roomId: string, socketId: string): { room: Room } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.gameType !== "emoji-guessing") return null;
    this.startEmojiGuessingInternal(room);
    return { room };
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
   * 列出所有公开等待中的房间（phase=WAITING 且人数未满）
   * 用于大厅房间列表展示
   */
  listPublicRooms(): RoomView[] {
    const result: RoomView[] = [];
    for (const room of this.rooms.values()) {
      if (room.state.phase === "WAITING" && room.players.length < MAX_PLAYERS) {
        result.push(this.toRoomView(room));
      }
    }
    // 按创建时间倒序：新房间排前面
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
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
      gameType: room.gameType,
      telepathyPackId: room.telepathyPackId,
      turtleDifficulty: room.turtleDifficulty,
      createdAt: room.createdAt,
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
