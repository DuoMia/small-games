// 前端共享类型定义
import type { Difficulty } from "./difficulty";

export type GamePhase =
  | "WAITING"
  | "WORD_DISPLAY"
  | "DRAWING"
  | "QUIZ"
  | "ROUND_RESULT"
  | "GAME_OVER";

// 游戏类型：画词记忆 / 默契考验 / 海龟汤 / 合作画画 / 表情包猜词
export type GameType = "draw-memory" | "telepathy" | "turtle-soup" | "co-op-drawing" | "emoji-guessing";

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
  createdAt: number; // 房间创建时间戳，用于大厅显示相对时间
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

// 默契考验题目数据
export interface TelepathyQuestionData {
  questionIndex: number;
  question: string;
  options: string[];
  totalQuestions: number;
}

// 默契考验揭晓数据
export interface TelepathyRevealData {
  questionIndex: number;
  myChoice: number;
  opponentChoice: number;
  myScore: number;
  opponentScore: number;
  match: "full" | "partial" | "none";
}

// ===== 海龟汤 =====

// 汤面数据
export interface TurtleSurfaceData {
  soupId: string;
  surface: string;
  difficulty: string;
  category: string;
  questionsLeft: number;
}

// 单条提问记录
export interface TurtleQuestionRecord {
  question: string;
  asker: string;
  answer: "是" | "否" | "无关";
}

// AI 回答事件
export interface TurtleAnsweredData {
  questionIndex: number;
  question: string;
  asker: string;
  answer: "是" | "否" | "无关";
  questionsLeft: number;
}

// 单条猜测记录
export interface TurtleGuessRecord {
  guess: string;
  guesser: string;
  correct: boolean;
  close: boolean;
  feedback: string;
}

// 猜测结果事件
export interface TurtleGuessResultData {
  guessIndex: number;
  guess: string;
  guesser: string;
  correct: boolean;
  close: boolean;
  feedback: string;
}

// 揭晓真相事件
export interface TurtleRevealData {
  truth: string;
  won: boolean;
}

// AI 思考中提示
export interface TurtleJudgingData {
  type: "question" | "guess";
}

// ===== 合作画画（同时画 + AI 评分）=====

// 合作画画笔画（含作者）
export interface CoOpStroke {
  color: string;
  size: number;
  isEraser: boolean;
  points: { x: number; y: number }[];
  author: string; // 画该笔的玩家 playerId
}

// 画布方向
export type CoOpOrientation = "landscape" | "portrait";

// 命题数据
export interface CoOpPromptData {
  prompt: string;
  orientation: CoOpOrientation;
}

// 倒计时数据
export interface CoOpTimeData {
  timeLeft: number;
}

// 结果数据（AI 评分）
export interface CoOpResultData {
  finalImage: string;
  aiScore: number;
  aiComment: string;
}

// ===== 表情包猜词 =====

// 表情包猜词单题结构
export interface EmojiPuzzle {
  id: number;
  category: string;
  emoji: string;
  answer: string;
  alternatives: string[];
}

// 题目下发数据
export interface EmojiQuestionData {
  questionIndex: number;
  emoji: string;
  category: string;
  totalQuestions: number;
  timeLimit: number;
}

// 揭晓数据（按玩家视角）
export interface EmojiRevealData {
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
}
