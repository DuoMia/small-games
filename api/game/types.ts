// 游戏核心类型定义

import type { Difficulty } from "./difficulty.js";

export type GamePhase =
  | "WAITING"
  | "WORD_DISPLAY"
  | "DRAWING"
  | "QUIZ"
  | "ROUND_RESULT"
  | "GAME_OVER";

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
}

// Socket 事件类型
export interface ClientToServerEvents {
  "room:create": (data: { nickname: string }) => void;
  "room:join": (data: { roomId: string; nickname: string }) => void;
  "room:ready": (data: { roomId: string }) => void;
  "room:set-words-count": (data: { roomId: string; count: number }) => void;
  "room:set-difficulty": (data: { roomId: string; difficulty: Difficulty }) => void;
  "game:start": (data: { roomId: string }) => void;
  "game:next-stage": (data: { roomId: string }) => void;
  "drawing:upload": (data: { roomId: string; drawings: string[] }) => void;
  "quiz:submit": (data: { roomId: string; questionIndex: number; answer: string }) => void;
  "quiz:next": (data: { roomId: string }) => void;
  "round:next": (data: { roomId: string }) => void;
  "game:restart": (data: { roomId: string }) => void;
  "room:leave": (data: { roomId: string }) => void;
}

export interface ServerToClientEvents {
  "room:created": (data: { roomId: string }) => void;
  "room:joined": (data: { room: RoomView }) => void;
  "room:updated": (data: { room: RoomView }) => void;
  "room:error": (data: { message: string }) => void;
  "game:state": (data: { phase: GamePhase; currentRound: number }) => void;
  "game:words": (data: { words: string[] }) => void;
  "game:config": (data: { viewTime: number; drawTime: number; wordDuration: number; totalQuestions: number }) => void;
  "quiz:question": (data: { questionIndex: number; wordIndex: number; totalQuestions: number }) => void;
  "quiz:result": (data: { questionIndex: number; correct: boolean; correctAnswer: string; score: number }) => void;
  "quiz:opponent-answered": (data: { questionIndex: number }) => void;
  "quiz:reveal": (data: { questionIndex: number; opponentAnswer: string; opponentCorrect: boolean }) => void;
  "round:result": (data: { scores: PlayerView[]; drawings: Record<string, string[]> }) => void;
  "game:over": (data: { finalScores: PlayerView[]; winnerId: string | null }) => void;
  "player:left": (data: { playerId: string }) => void;
  "connect_error": (data: { message: string }) => void;
}
