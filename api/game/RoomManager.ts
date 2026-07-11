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
  HeartCard,
  HeartFruit,
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
// 合作画画命题题库
import drawingPrompts from "../data/drawing-prompts.json";
// 表情包猜词题库
import emojiPuzzlesData from "../data/emoji-puzzles.json";
import { judgeDrawing } from "../ai/judge.js";

const TOTAL_ROUNDS = 3;
const MAX_PLAYERS = 2;
// 题量（=词数=答题数）可选值
const VALID_WORD_COUNTS = [15, 30];
// 默契考验总题数
const TELEPATHY_TOTAL_QUESTIONS = 10;
// 默契考验默认题包
const DEFAULT_TELEPATHY_PACK = "life";
// 德国心脏病总牌数
const HEART_DECK_TOTAL = 60;
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
  async startGame(roomId: string, socketId: string): Promise<{ room: Room; words: string[] } | null> {
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

    if (room.gameType === "heart-attack") {
      // 德国心脏病：生成 60 张牌洗牌后 30/30 均分，进入 DRAWING（游戏中）
      this.startHeartAttackInternal(room);
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
  async restartGame(roomId: string, socketId: string): Promise<{ room: Room; words: string[] } | null> {
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

    if (room.gameType === "heart-attack") {
      this.startHeartAttackInternal(room);
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

  // ============ 德国心脏病相关 ============

  /**
   * 生成德国心脏病牌堆：4 种水果各 15 张（1-5 各 3 张），共 60 张
   * Fisher-Yates 洗牌后返回
   */
  private generateHeartDeck(): HeartCard[] {
    const fruits: HeartFruit[] = ["apple", "banana", "cherry", "lemon"];
    const deck: HeartCard[] = [];
    for (const fruit of fruits) {
      // 每种水果：1-5 各 3 张 = 15 张
      for (let count = 1; count <= 5; count++) {
        for (let i = 0; i < 3; i++) {
          deck.push({ fruit, count });
        }
      }
    }
    // Fisher-Yates 洗牌
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  /**
   * 内部启动德国心脏病（开始或重玩都走这里）
   * 生成 60 张牌洗牌后 30/30 均分给双方
   */
  private startHeartAttackInternal(room: Room) {
    // 重置玩家分数
    room.players.forEach((p) => {
      p.totalScore = 0;
      p.roundScore = 0;
      p.drawings = [];
      p.answers = [];
    });

    const fullDeck = this.generateHeartDeck();
    const half = Math.floor(fullDeck.length / 2); // 30

    const deck: Record<string, HeartCard[]> = {};
    const won: Record<string, number> = {};
    const flipped: Record<string, boolean> = {};
    room.players.forEach((p, idx) => {
      deck[p.id] = fullDeck.slice(idx * half, (idx + 1) * half);
      won[p.id] = 0;
      flipped[p.id] = false;
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
      // 德国心脏病字段
      heartDeck: deck,
      heartWon: won,
      heartTable: [],
      heartFlipped: flipped,
      heartLastResult: null,
      heartGameOver: false,
    };
  }

  /**
   * 判断桌面上是否有任意水果总数恰好为 5
   */
  private hasFruitFive(table: { card: HeartCard; owner: string }[]): boolean {
    const sums: Record<string, number> = { apple: 0, banana: 0, cherry: 0, lemon: 0 };
    for (const item of table) {
      sums[item.card.fruit] += item.card.count;
    }
    return (Object.values(sums) as number[]).some((s) => s === 5);
  }

  /**
   * 获取德国心脏病当前状态（按玩家视角）
   */
  getHeartStateView(room: Room, socketId: string): {
    myDeckCount: number;
    myWonCount: number;
    opponentDeckCount: number;
    opponentWonCount: number;
    tableCards: { card: HeartCard; owner: string }[];
    myFlipped: boolean;
    opponentFlipped: boolean;
    canRing: boolean;
  } | null {
    if (!room.state.heartDeck) return null;
    const opponent = room.players.find((p) => p.id !== socketId);
    const myDeck = room.state.heartDeck[socketId] || [];
    const opponentDeck = opponent ? (room.state.heartDeck[opponent.id] || []) : [];
    const table = room.state.heartTable || [];
    return {
      myDeckCount: myDeck.length,
      myWonCount: room.state.heartWon?.[socketId] ?? 0,
      opponentDeckCount: opponentDeck.length,
      opponentWonCount: opponent ? (room.state.heartWon?.[opponent.id] ?? 0) : 0,
      tableCards: table,
      myFlipped: room.state.heartFlipped?.[socketId] ?? false,
      opponentFlipped: opponent ? (room.state.heartFlipped?.[opponent.id] ?? false) : false,
      canRing: this.hasFruitFive(table),
    };
  }

  /**
   * 翻牌：玩家翻出自己牌堆顶的一张到桌面
   * 返回 null 表示参数错误；返回对象表示翻牌成功
   */
  flipHeartCard(
    roomId: string,
    socketId: string
  ): { ok: true; room: Room } | { ok: false; error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: "房间不存在" };
    if (room.gameType !== "heart-attack") return { ok: false, error: "非德国心脏病房间" };
    if (room.state.phase !== "DRAWING") return { ok: false, error: "当前不可翻牌" };
    if (room.state.heartGameOver) return { ok: false, error: "游戏已结束" };
    const player = room.players.find((p) => p.id === socketId);
    if (!player) return { ok: false, error: "玩家不存在" };
    // 本轮已翻过
    if (room.state.heartFlipped?.[socketId]) return { ok: false, error: "本轮已翻牌" };
    const deck = room.state.heartDeck?.[socketId] || [];
    if (deck.length === 0) return { ok: false, error: "牌堆已空" };

    // 弹出牌堆顶（末尾）的一张
    const card = deck.pop()!;
    room.state.heartDeck[socketId] = deck;
    // 加入桌面
    const table = room.state.heartTable || [];
    table.push({ card, owner: socketId });
    room.state.heartTable = table;
    // 标记本轮已翻
    const flipped = room.state.heartFlipped || {};
    flipped[socketId] = true;
    room.state.heartFlipped = flipped;

    // 检查是否需要进入下一轮（双方都翻完且无可拍铃）
    // 下一轮由 nextHeartRound 处理，这里不自动推进，等待前端或拍铃触发

    return { ok: true, room };
  }

  /**
   * 推进到下一轮：双方都翻完后，如果没人拍铃，重置 flipped 标记
   * 在前端"翻牌"按钮可用时自动调用（双方都翻完且无 fruit=5 时）
   */
  nextHeartRound(roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.gameType !== "heart-attack") return null;
    if (room.state.phase !== "DRAWING") return null;
    if (room.state.heartGameOver) return null;
    // 必须双方都翻完
    const allFlipped = room.players.every((p) => room.state.heartFlipped?.[p.id]);
    if (!allFlipped) return null;
    // 桌面无 fruit=5 才推进（有 fruit=5 时等待拍铃）
    if (this.hasFruitFive(room.state.heartTable || [])) return null;
    // 重置 flipped，进入下一轮
    const flipped: Record<string, boolean> = {};
    room.players.forEach((p) => { flipped[p.id] = false; });
    room.state.heartFlipped = flipped;
    return room;
  }

  /**
   * 拍铃：验证桌面是否有水果总数=5
   * 正确：拍铃者赢得桌面所有牌，清空桌面，重置 flipped
   * 错误：拍铃者给对手 1 张牌（从牌堆顶）
   * 返回结果对象，由 handler 广播
   */
  ringHeartBell(
    roomId: string,
    socketId: string
  ): { ok: true; room: Room; type: "correct" | "wrong"; ringerId: string; ringerNickname: string; gameOver: boolean } | { ok: false; error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: "房间不存在" };
    if (room.gameType !== "heart-attack") return { ok: false, error: "非德国心脏病房间" };
    if (room.state.phase !== "DRAWING") return { ok: false, error: "当前不可拍铃" };
    if (room.state.heartGameOver) return { ok: false, error: "游戏已结束" };
    const player = room.players.find((p) => p.id === socketId);
    if (!player) return { ok: false, error: "玩家不存在" };

    const table = room.state.heartTable || [];
    const isCorrect = this.hasFruitFive(table);

    if (isCorrect) {
      // 正确拍铃：拍铃者赢得桌面所有牌
      const wonCount = table.length;
      const won = room.state.heartWon || {};
      won[socketId] = (won[socketId] ?? 0) + wonCount;
      room.state.heartWon = won;
      // 清空桌面
      room.state.heartTable = [];
      // 重置 flipped
      const flipped: Record<string, boolean> = {};
      room.players.forEach((p) => { flipped[p.id] = false; });
      room.state.heartFlipped = flipped;
      room.state.heartLastResult = { type: "correct", ringerId: socketId, ringerNickname: player.nickname };
    } else {
      // 错误拍铃：给对手 1 张牌（从自己牌堆顶）
      const opponent = room.players.find((p) => p.id !== socketId);
      if (!opponent) return { ok: false, error: "对手不存在" };
      const myDeck = room.state.heartDeck?.[socketId] || [];
      if (myDeck.length > 0) {
        const card = myDeck.pop()!;
        room.state.heartDeck[socketId] = myDeck;
        // 对手牌堆底部加入（保持牌堆顺序，加到开头）
        const oppDeck = room.state.heartDeck?.[opponent.id] || [];
        oppDeck.unshift(card);
        room.state.heartDeck[opponent.id] = oppDeck;
      }
      room.state.heartLastResult = { type: "wrong", ringerId: socketId, ringerNickname: player.nickname };
    }

    // 检查游戏结束：任一玩家牌堆为空
    const anyEmpty = room.players.some((p) => (room.state.heartDeck?.[p.id] || []).length === 0);
    let gameOver = false;
    if (anyEmpty) {
      room.state.heartGameOver = true;
      room.state.phase = "GAME_OVER";
      gameOver = true;
    }

    return { ok: true, room, type: isCorrect ? "correct" : "wrong", ringerId: socketId, ringerNickname: player.nickname, gameOver };
  }

  /**
   * 获取德国心脏病游戏结束数据（按玩家视角）
   */
  getHeartGameOverData(room: Room, socketId: string): {
    winnerId: string | null;
    myWon: number;
    opponentWon: number;
    reason: "deck-empty";
  } | null {
    if (!room.state.heartGameOver) return null;
    const opponent = room.players.find((p) => p.id !== socketId);
    const myWon = room.state.heartWon?.[socketId] ?? 0;
    const opponentWon = opponent ? (room.state.heartWon?.[opponent.id] ?? 0) : 0;
    let winnerId: string | null;
    if (myWon > opponentWon) {
      winnerId = socketId;
    } else if (opponentWon > myWon) {
      winnerId = opponent?.id ?? null;
    } else {
      winnerId = null; // 平局
    }
    return { winnerId, myWon, opponentWon, reason: "deck-empty" };
  }

  /**
   * 重玩德国心脏病（房主触发，重新洗牌）
   */
  restartHeartAttack(roomId: string, socketId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.hostId !== socketId) return null;
    if (room.gameType !== "heart-attack") return null;
    this.startHeartAttackInternal(room);
    return room;
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
