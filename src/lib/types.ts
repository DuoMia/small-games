// 前端共享类型定义
import type { Difficulty } from "./difficulty";

export type GamePhase =
  | "WAITING"
  | "WORD_DISPLAY"
  | "DRAWING"
  | "QUIZ"
  | "ROUND_RESULT"
  | "GAME_OVER";

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

export interface GameConfig {
  viewTime: number;
  drawTime: number;
  wordDuration: number;
  totalQuestions: number;
}

export interface DrawingWaitData {
  playerId: string;
}

export interface QuestionData {
  questionIndex: number;
  wordIndex: number;
  totalQuestions: number;
}

export interface QuizResultData {
  questionIndex: number;
  correct: boolean;
  correctAnswer: string;
  score: number;
}

export interface QuizRevealData {
  questionIndex: number;
  opponentAnswer: string;
  opponentCorrect: boolean;
}

export interface RoundResultData {
  scores: PlayerView[];
  drawings: Record<string, string[]>;
}

export interface GameOverData {
  finalScores: PlayerView[];
  winnerId: string | null;
}
