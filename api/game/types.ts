// 游戏核心类型定义

import type { Difficulty } from "./difficulty.js";

export type GamePhase =
  | "WAITING"
  | "WORD_DISPLAY"
  | "DRAWING"
  | "QUIZ"
  | "ROUND_RESULT"
  | "GAME_OVER";

// 游戏类型：画词记忆 / 默契考验 / 双人解密 / 合作画画 / 表情包猜词
export type GameType = "draw-memory" | "telepathy" | "mystery" | "co-op-drawing" | "emoji-guessing";

// 表情包猜词单题结构
export interface EmojiPuzzle {
  id: number;
  category: string;
  emoji: string;
  answer: string;
  alternatives: string[];
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
  // 双人解密专用字段
  mysteryCaseId?: string; // 当前谜题ID
  mysteryTitle?: string; // 谜题标题
  mysteryStory?: string; // 故事背景
  mysteryCluesA?: string[]; // 玩家A的线索
  mysteryCluesB?: string[]; // 玩家B的线索
  mysteryAnswer?: string; // 正确答案（只在后端用，不发给前端）
  mysteryKeywords?: string[];
  mysteryCategory?: string; // 谜题分类
  mysteryDifficulty?: string; // 谜题难度
  mysteryAttemptsLeft?: number; // 剩余答题次数，初始3
  mysteryStartTime?: number; // 开始时间戳（用于5分钟倒计时）
  mysteryTimeLimit?: number; // 时间限制（秒），默认300
  mysteryResolved?: boolean; // 是否已揭晓
  mysteryChat?: { sender: string; text: string; ts: number }[]; // 聊天记录
  mysteryGuesses?: { guess: string; guesser: string; correct: boolean; close: boolean; feedback: string }[]; // 答题历史
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
  mysteryDifficulty?: string; // 双人解密难度：any/simple/medium/hard
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
  mysteryDifficulty?: string;
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
  // 双人解密
  "room:set-mystery-difficulty": (data: { roomId: string; difficulty: string }) => void;
  "mystery:chat": (data: { roomId: string; text: string }) => void;
  "mystery:submit": (data: { roomId: string; answer: string }) => void;
  "mystery:restart": (data: { roomId: string }) => void;
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
  // 双人解密
  "mystery:case": (data: { caseId: string; title: string; story: string; clues: string[]; difficulty: string; category: string; attemptsLeft: number; timeLimit: number }) => void;
  "mystery:chat": (data: { sender: string; text: string; ts: number }) => void;
  "mystery:submit-result": (data: { guessIndex: number; guess: string; guesser: string; correct: boolean; close: boolean; feedback: string; attemptsLeft: number }) => void;
  "mystery:reveal": (data: { answer: string; won: boolean }) => void;
  "mystery:judging": () => void;
  "mystery:time-update": (data: { timeLeft: number }) => void;
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
}
