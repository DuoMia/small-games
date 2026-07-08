// 前端共享类型定义
import type { Difficulty } from "./difficulty";

export type GamePhase =
  | "WAITING"
  | "WORD_DISPLAY"
  | "DRAWING"
  | "QUIZ"
  | "ROUND_RESULT"
  | "GAME_OVER";

// 游戏类型：画词记忆 / 默契考验 / 双人解密 / 合作画画 / 表情包猜词
export type GameType = "draw-memory" | "telepathy" | "mystery" | "co-op-drawing" | "emoji-guessing";

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

// ===== 双人解密 =====

// 谜题下发数据（每个玩家拿到的线索不同，由后端按视角下发）
export interface MysteryCaseData {
  caseId: string;
  title: string;
  story: string;
  clues: string[];
  difficulty: string;
  category: string;
  attemptsLeft: number;
  timeLimit: number;
}

// 单条聊天记录
export interface MysteryChatRecord {
  sender: string;
  text: string;
  ts: number;
}

// 单条答题记录
export interface MysteryGuessRecord {
  guess: string;
  guesser: string;
  correct: boolean;
  close: boolean;
  feedback: string;
}

// 答题结果事件
export interface MysterySubmitResultData {
  guessIndex: number;
  guess: string;
  guesser: string;
  correct: boolean;
  close: boolean;
  feedback: string;
  attemptsLeft: number;
}

// 揭晓答案事件
export interface MysteryRevealData {
  answer: string;
  won: boolean;
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
