// 游戏核心类型定义

import type { Difficulty } from "./difficulty.js";

export type GamePhase =
  | "WAITING"
  | "WORD_DISPLAY"
  | "DRAWING"
  | "QUIZ"
  | "ROUND_RESULT"
  | "GAME_OVER";

// 游戏类型：画词记忆 / 默契考验 / 德国心脏病 / 合作画画 / 表情包猜词 / 达芬奇密码
export type GameType = "draw-memory" | "telepathy" | "heart-attack" | "co-op-drawing" | "emoji-guessing" | "davinci-code";

// 表情包猜词单题结构
export interface EmojiPuzzle {
  id: number;
  category: string;
  emoji: string;
  answer: string;
  alternatives: string[];
}

// 德国心脏病水果类型
export type HeartFruit = "apple" | "banana" | "cherry" | "lemon";

// 水果条目（混合水果牌中每种水果及数量）
export interface HeartFruitItem {
  fruit: HeartFruit;
  count: number;
}

// 德国心脏病单张牌（混合水果，可能有1-4种水果组合）
export interface HeartCard {
  fruits: HeartFruitItem[];
}

// ===== 达芬奇密码 =====

// 达芬奇密码牌颜色
export type DaVinciColor = "black" | "white";

// 达芬奇密码单张牌
export interface DaVinciCard {
  id: string;
  color: DaVinciColor;
  number: number; // 0-11
  revealed: boolean; // 是否已被破译（倒下/亮出）
}

// 达芬奇密码猜牌结果
export interface DaVinciGuessResult {
  correct: boolean;
  guesserId: string;
  guesserNickname: string;
  targetId: string; // 被猜的玩家
  targetCardIndex: number; // 被猜牌的位置索引
  targetCardId: string; // 被猜牌的ID（用于追踪错误猜测）
  guessedNumber: number;
  actualNumber?: number; // 仅猜对时展示（同guessedNumber）
  gameOver?: boolean;
}

// 合作画画单笔笔画
export interface CoOpStroke {
  color: string;
  size: number;
  isEraser: boolean;
  points: { x: number; y: number }[];
  author: string; // 画该笔的玩家 playerId
}

// 默契考验单题结构
export interface TelepathyQuestion {
  question: string;
  options: string[];
}

export interface WordEntry {
  word: string;
  synonyms: string[];
  category: string;
}

export interface Player {
  id: string;
  nickname: string;
  isReady: boolean;
  isHost: boolean;
  totalScore: number;
  roundScore: number;
  drawings: string[];
  answers: boolean[];
  online: boolean;
}

export interface Question {
  wordIndex: number;
  correctAnswer: string;
  acceptedAnswers: string[];
}

export interface GameState {
  phase: GamePhase;
  currentRound: number;
  words: string[];
  wordEntries: WordEntry[];
  questions: Question[];
  currentQuestionIndex: number;
  // 内部同步追踪
  stageReady: Record<string, boolean>;
  drawingUploaded: Record<string, boolean>;
  answers: Record<string, string>;
  answerResults: Record<string, boolean>;
  questionNextReady: Record<string, boolean>;
  revealed: boolean;
  // 默契考验专用字段
  telepathyQuestions?: TelepathyQuestion[];
  currentTelepathyIndex?: number;
  telepathyChoices?: Record<string, number>; // playerId -> 选项索引
  telepathyScores?: Record<string, number>; // playerId -> 本题得分
  telepathyRevealed?: boolean;
  // 德国心脏病专用字段
  heartDeck?: Record<string, HeartCard[]>; // playerId -> 牌堆（剩余可翻的牌）
  heartWon?: Record<string, number>; // playerId -> 赢到的牌数
  heartTable?: { card: HeartCard; owner: string }[]; // 桌面上累积的牌
  heartFlipped?: Record<string, boolean>; // 本轮各玩家是否已翻牌（兼容字段，实际用currentFlipperId）
  heartCurrentFlipperId?: string; // 当前轮到谁翻牌
  heartTotalFlipped?: number; // 已翻出的总牌数（用于显示）
  heartLastResult?: { type: "correct" | "wrong"; ringerId: string; ringerNickname: string; penaltyCards?: number } | null;
  heartGameOver?: boolean;
  // 合作画画专用字段（同时画 + AI 评分玩法）
  coOpPrompt?: string; // 当前命题
  coOpStrokes?: CoOpStroke[]; // 所有已完成笔画
  coOpCurrentStroke?: CoOpStroke | null; // 当前进行中的笔画（未完成，仅作追踪用）
  coOpOrientation?: "landscape" | "portrait"; // 画布方向：横屏 / 竖屏
  coOpAIScore?: number; // AI 评分（0-10）
  coOpAIComment?: string; // AI 评语
  coOpStartTime?: number; // 画图阶段开始时间戳（用于计时）
  // 表情包猜词专用字段
  emojiPuzzles?: EmojiPuzzle[]; // 选中的10题
  currentEmojiIndex?: number; // 当前题目索引
  emojiGuesses?: Record<string, string>; // playerId -> 猜测
  emojiResults?: Record<string, boolean>; // playerId -> 是否答对
  emojiScores?: Record<string, number>; // playerId -> 本题得分
  emojiRevealed?: boolean; // 是否已揭晓
  emojiTotalScores?: Record<string, number>; // playerId -> 累计总分
  // 达芬奇密码专用字段
  dvDeck?: DaVinciCard[]; // 剩余牌堆（面朝下）
  dvHands?: Record<string, DaVinciCard[]>; // playerId -> 手牌（已排序）
  dvDrawn?: Record<string, DaVinciCard | null>; // playerId -> 刚摸的临时牌（未放入手牌）
  dvCurrentPlayerId?: string; // 当前回合玩家
  dvPhase?: "draw" | "guess" | "end"; // draw=待摸牌, guess=待猜牌, end=游戏结束
  dvLastResult?: DaVinciGuessResult | null; // 上次猜牌结果
  dvContinues?: boolean; // 猜对后是否继续猜（不摸牌）
  dvGameOver?: boolean;
  dvWinnerId?: string | null;
}

export interface Room {
  roomId: string;
  hostId: string;
  players: Player[];
  state: GameState;
  usedWords: string[];
  createdAt: number;
  wordsPerRound: number;
  difficulty: Difficulty;
  gameType: GameType;
  telepathyPackId?: string; // 房主选的题包
}

// 客户端用的简化玩家信息
export interface PlayerView {
  id: string;
  nickname: string;
  isReady: boolean;
  isHost: boolean;
  totalScore: number;
  roundScore: number;
  online: boolean;
}

export interface RoomView {
  roomId: string;
  hostId: string;
  players: PlayerView[];
  phase: GamePhase;
  currentRound: number;
  wordsPerRound: number;
  difficulty: Difficulty;
  gameType: GameType;
  telepathyPackId?: string;
  createdAt: number; // 房间创建时间戳，用于大厅显示相对时间
}

// Socket 事件类型
export interface ClientToServerEvents {
  "room:create": (data: { nickname: string; gameType?: GameType }) => void;
  "room:join": (data: { roomId: string; nickname: string }) => void;
  "room:list": () => void;
  "room:ready": (data: { roomId: string }) => void;
  "room:set-words-count": (data: { roomId: string; count: number }) => void;
  "room:set-difficulty": (data: { roomId: string; difficulty: Difficulty }) => void;
  "room:set-telepathy-pack": (data: { roomId: string; packId: string }) => void;
  "game:start": (data: { roomId: string }) => void;
  "game:next-stage": (data: { roomId: string }) => void;
  "drawing:upload": (data: { roomId: string; drawings: string[] }) => void;
  "quiz:submit": (data: { roomId: string; questionIndex: number; answer: string }) => void;
  "quiz:next": (data: { roomId: string }) => void;
  "round:next": (data: { roomId: string }) => void;
  "game:restart": (data: { roomId: string }) => void;
  "room:leave": (data: { roomId: string }) => void;
  "telepathy:choose": (data: { roomId: string; questionIndex: number; choice: number }) => void;
  "telepathy:next": (data: { roomId: string }) => void;
  "telepathy:restart": (data: { roomId: string }) => void;
  // 德国心脏病
  "heart:flip": (data: { roomId: string }) => void;
  "heart:ring": (data: { roomId: string }) => void;
  "heart:restart": (data: { roomId: string }) => void;
  // 合作画画（同时画 + AI 评分）
  "coop:stroke-start": (data: { roomId: string; stroke: Omit<CoOpStroke, "author"> }) => void;
  "coop:stroke-point": (data: { roomId: string; point: { x: number; y: number } }) => void;
  "coop:stroke-end": (data: { roomId: string; stroke: CoOpStroke }) => void;
  "coop:set-orientation": (data: { roomId: string; orientation: "landscape" | "portrait" }) => void;
  "coop:submit-drawing": (data: { roomId: string; image: string }) => void;
  "coop:restart": (data: { roomId: string }) => void;
  // 表情包猜词
  "emoji:submit": (data: { roomId: string; questionIndex: number; guess: string }) => void;
  "emoji:next": (data: { roomId: string }) => void;
  "emoji:restart": (data: { roomId: string }) => void;
  // 达芬奇密码
  "dv:draw": (data: { roomId: string }) => void;
  "dv:guess": (data: { roomId: string; targetId: string; cardIndex: number; number: number }) => void;
  "dv:pass": (data: { roomId: string }) => void;
  "dv:restart": (data: { roomId: string }) => void;
}

export interface ServerToClientEvents {
  "room:created": (data: { roomId: string }) => void;
  "room:joined": (data: { room: RoomView }) => void;
  "room:updated": (data: { room: RoomView }) => void;
  "room:list": (data: { rooms: RoomView[] }) => void;
  "room:error": (data: { message: string }) => void;
  "game:state": (data: { phase: GamePhase; currentRound: number }) => void;
  "game:words": (data: { words: string[] }) => void;
  "game:config": (data: { viewTime: number; drawTime: number; wordDuration: number; totalQuestions: number }) => void;
  "drawing:wait": (data: { playerId: string }) => void;
  "quiz:question": (data: { questionIndex: number; wordIndex: number; totalQuestions: number }) => void;
  "quiz:result": (data: { questionIndex: number; correct: boolean; correctAnswer: string; score: number }) => void;
  "quiz:opponent-answered": (data: { questionIndex: number }) => void;
  "quiz:reveal": (data: { questionIndex: number; opponentAnswer: string; opponentCorrect: boolean }) => void;
  "round:result": (data: { scores: PlayerView[]; drawings: Record<string, string[]> }) => void;
  "game:over": (data: { finalScores: PlayerView[]; winnerId: string | null }) => void;
  "player:left": (data: { playerId: string }) => void;
  "connect_error": (data: { message: string }) => void;
  "telepathy:question": (data: { questionIndex: number; question: string; options: string[]; totalQuestions: number }) => void;
  "telepathy:reveal": (data: { questionIndex: number; myChoice: number; opponentChoice: number; myScore: number; opponentScore: number; match: "full" | "partial" | "none" }) => void;
  "telepathy:opponent-chose": (data: { questionIndex: number }) => void;
  // 德国心脏病
  "heart:state": (data: {
    myDeckCount: number;
    myWonCount: number;
    opponentDeckCount: number;
    opponentWonCount: number;
    tableCards: { card: HeartCard; owner: string }[];
    myTurn: boolean;
    opponentTurn: boolean;
    currentFlipperId: string | null;
    canRing: boolean;
    totalFlipped: number;
    difficulty: string;
  }) => void;
  "heart:result": (data: { type: "correct" | "wrong"; ringerId: string; ringerNickname: string; penaltyCards?: number }) => void;
  "heart:game-over": (data: { winnerId: string | null; myWon: number; opponentWon: number; reason: "deck-empty" | "all-empty" }) => void;
  // 合作画画（同时画 + AI 评分）
  "coop:prompt": (data: { prompt: string; orientation: "landscape" | "portrait" }) => void;
  "coop:orientation-changed": (data: { orientation: "landscape" | "portrait" }) => void;
  "coop:time-update": (data: { timeLeft: number }) => void;
  "coop:ai-judging": () => void;
  "coop:stroke-start": (data: { stroke: CoOpStroke }) => void;
  "coop:stroke-point": (data: { point: { x: number; y: number } }) => void;
  "coop:stroke-end": (data: {}) => void;
  "coop:result": (data: { finalImage: string; aiScore: number; aiComment: string }) => void;
  // 表情包猜词
  "emoji:question": (data: { questionIndex: number; emoji: string; category: string; totalQuestions: number; timeLimit: number }) => void;
  "emoji:opponent-answered": (data: { questionIndex: number }) => void;
  "emoji:reveal": (data: { questionIndex: number; myGuess: string; opponentGuess: string; answer: string; myCorrect: boolean; opponentCorrect: boolean; myScore: number; opponentScore: number; myTotal: number; opponentTotal: number }) => void;
  // 达芬奇密码
  "dv:state": (data: {
    myHand: DaVinciCard[];
    opponentHand: DaVinciCard[]; // opponentHand 中未亮的牌 number 不展示，用 -1 标记
    deckCount: number;
    myDrawnCard: DaVinciCard | null;
    opponentDrawn: boolean;
    myTurn: boolean;
    phase: "draw" | "guess" | "end";
    canContinue: boolean; // 猜对后可选择继续猜
  }) => void;
  "dv:drew": (data: { playerId: string; color: DaVinciColor; number?: number; isSelf: boolean }) => void;
  "dv:guess-result": (data: DaVinciGuessResult & { gameOver?: boolean }) => void;
  "dv:passed": (data: { playerId: string }) => void;
  "dv:game-over": (data: { winnerId: string | null; winnerNickname: string; myRevealed: number; opponentRevealed: number }) => void;
}
