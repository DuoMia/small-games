// 游戏核心类型定义

import type { Difficulty } from "./difficulty.js";

export type GamePhase =
  | "WAITING"
  | "WORD_DISPLAY"
  | "DRAWING"
  | "QUIZ"
  | "ROUND_RESULT"
  | "GAME_OVER";

// 游戏类型：画词记忆 / 默契考验 / 海龟汤
export type GameType = "draw-memory" | "telepathy" | "turtle-soup";

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
  // 海龟汤专用字段
  turtleSoupId?: string; // 当前汤面ID
  turtleSoupSurface?: string; // 汤面
  turtleSoupTruth?: string; // 汤底（只在后端用，不发给前端）
  turtleSoupKeywords?: string[];
  turtleSoupCategory?: string; // 汤面分类
  turtleQuestions?: { question: string; asker: string; answer: "是" | "否" | "无关" }[]; // 提问历史
  turtleGuesses?: { guess: string; guesser: string; correct: boolean; close: boolean; feedback: string }[];
  turtleQuestionsLeft?: number; // 剩余提问次数，初始20
  turtleResolved?: boolean; // 是否已猜中
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
  turtleDifficulty?: string; // 海龟汤难度：any/easy/medium/hard
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
  turtleDifficulty?: string;
}

// Socket 事件类型
export interface ClientToServerEvents {
  "room:create": (data: { nickname: string; gameType?: GameType }) => void;
  "room:join": (data: { roomId: string; nickname: string }) => void;
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
  // 海龟汤
  "room:set-turtle-difficulty": (data: { roomId: string; difficulty: string }) => void;
  "turtle:ask": (data: { roomId: string; question: string }) => void;
  "turtle:guess": (data: { roomId: string; guess: string }) => void;
  "turtle:restart": (data: { roomId: string }) => void;
}

export interface ServerToClientEvents {
  "room:created": (data: { roomId: string }) => void;
  "room:joined": (data: { room: RoomView }) => void;
  "room:updated": (data: { room: RoomView }) => void;
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
  // 海龟汤
  "turtle:surface": (data: { soupId: string; surface: string; difficulty: string; category: string; questionsLeft: number }) => void;
  "turtle:answered": (data: { questionIndex: number; question: string; asker: string; answer: "是" | "否" | "无关"; questionsLeft: number }) => void;
  "turtle:guess-result": (data: { guessIndex: number; guess: string; guesser: string; correct: boolean; close: boolean; feedback: string }) => void;
  "turtle:reveal": (data: { truth: string; won: boolean }) => void;
  "turtle:judging": (data: { type: "question" | "guess" }) => void;
}
