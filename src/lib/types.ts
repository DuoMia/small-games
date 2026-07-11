// 前端共享类型定义
import type { Difficulty } from "./difficulty";

export type GamePhase =
  | "WAITING"
  | "WORD_DISPLAY"
  | "DRAWING"
  | "QUIZ"
  | "ROUND_RESULT"
  | "GAME_OVER";

// 游戏类型：画词记忆 / 默契考验 / 德国心脏病 / 合作画画 / 表情包猜词
export type GameType = "draw-memory" | "telepathy" | "heart-attack" | "co-op-drawing" | "emoji-guessing";

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

// ===== 德国心脏病 =====

// 水果类型：苹果 / 香蕉 / 樱桃 / 柠檬
export type HeartFruit = "apple" | "banana" | "cherry" | "lemon";

// 单张牌：一种水果 + 数量（1-5）
export interface HeartCard {
  fruit: HeartFruit;
  count: number;
}

// 桌面上的牌（含归属，用于前端展示左右两张）
export interface HeartTableCard {
  card: HeartCard;
  owner: string; // 出牌玩家 playerId
}

// 德国心脏病状态下发（按玩家视角，myDeckCount/opponentDeckCount 区分）
export interface HeartStateData {
  myDeckCount: number; // 我的牌堆剩余张数
  myWonCount: number; // 我赢到的牌数
  opponentDeckCount: number;
  opponentWonCount: number;
  tableCards: HeartTableCard[]; // 桌面上所有牌
  myFlipped: boolean; // 本轮我是否已翻牌
  opponentFlipped: boolean;
  canRing: boolean; // 桌面是否有水果总数=5（可拍铃）
}

// 单次拍铃结果
export interface HeartResultData {
  type: "correct" | "wrong";
  ringerId: string; // 拍铃玩家
  ringerNickname: string;
  // correct: 拍铃者赢得桌面所有牌
  // wrong: 拍铃者给对手 1 张牌
}

// 游戏结束数据
export interface HeartGameOverData {
  winnerId: string | null;
  myWon: number;
  opponentWon: number;
  reason: "deck-empty"; // 牌堆耗尽
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
