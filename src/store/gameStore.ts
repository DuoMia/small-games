import { create } from "zustand";
import type {
  GamePhase,
  PlayerView,
  RoomView,
  QuestionData,
  QuizResultData,
  QuizRevealData,
  RoundResultData,
  GameOverData,
} from "@/lib/types";

interface GameState {
  // 连接
  connected: boolean;
  myId: string | null;

  // 房间
  room: RoomView | null;
  error: string | null;

  // 游戏数据
  phase: GamePhase;
  currentRound: number;
  words: string[];
  drawings: string[]; // 自己的30张画作

  // 答题
  currentQuestion: QuestionData | null;
  quizResult: QuizResultData | null;
  quizReveal: QuizRevealData | null;
  opponentAnswered: boolean;

  // 结算
  roundResult: RoundResultData | null;
  gameOver: GameOverData | null;

  // Actions
  setConnected: (v: boolean) => void;
  setMyId: (id: string) => void;
  setRoom: (room: RoomView | null) => void;
  setError: (msg: string | null) => void;
  setPhase: (phase: GamePhase, round?: number) => void;
  setWords: (words: string[]) => void;
  setDrawings: (drawings: string[]) => void;
  setCurrentQuestion: (q: QuestionData | null) => void;
  setQuizResult: (r: QuizResultData | null) => void;
  setQuizReveal: (r: QuizRevealData | null) => void;
  setOpponentAnswered: (v: boolean) => void;
  setRoundResult: (r: RoundResultData | null) => void;
  setGameOver: (g: GameOverData | null) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  connected: false,
  myId: null,
  room: null,
  error: null,
  phase: "WAITING",
  currentRound: 0,
  words: [],
  drawings: [],
  currentQuestion: null,
  quizResult: null,
  quizReveal: null,
  opponentAnswered: false,
  roundResult: null,
  gameOver: null,

  setConnected: (v) => set({ connected: v }),
  setMyId: (id) => set({ myId: id }),
  setRoom: (room) => set({ room, error: null }),
  setError: (msg) => set({ error: msg }),
  setPhase: (phase, round) =>
    set((s) => ({
      phase,
      currentRound: round ?? s.currentRound,
      // 切换阶段时清理答题状态
      ...(phase !== "QUIZ" ? { currentQuestion: null, quizResult: null, quizReveal: null, opponentAnswered: false } : {}),
      // 新阶段开始时清理结算
      ...(phase === "WORD_DISPLAY" ? { roundResult: null, gameOver: null } : {}),
    })),
  setWords: (words) => set({ words }),
  setDrawings: (drawings) => set({ drawings }),
  setCurrentQuestion: (q) =>
    set({
      currentQuestion: q,
      quizResult: null,
      quizReveal: null,
      opponentAnswered: false,
    }),
  setQuizResult: (r) => set({ quizResult: r }),
  setQuizReveal: (r) => set({ quizReveal: r }),
  setOpponentAnswered: (v) => set({ opponentAnswered: v }),
  setRoundResult: (r) => set({ roundResult: r }),
  setGameOver: (g) => set({ gameOver: g }),
  reset: () =>
    set({
      room: null,
      error: null,
      phase: "WAITING",
      currentRound: 0,
      words: [],
      drawings: [],
      currentQuestion: null,
      quizResult: null,
      quizReveal: null,
      opponentAnswered: false,
      roundResult: null,
      gameOver: null,
    }),
}));
