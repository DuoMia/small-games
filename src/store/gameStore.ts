import { create } from "zustand";
import type {
  GamePhase,
  PlayerView,
  RoomView,
  GameConfig,
  QuestionData,
  QuizResultData,
  QuizRevealData,
  RoundResultData,
  GameOverData,
  TelepathyQuestionData,
  TelepathyRevealData,
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
  drawings: string[]; // 自己的画作
  gameConfig: GameConfig | null; // 难度对应的时间/题量配置

  // 答题
  currentQuestion: QuestionData | null;
  quizResult: QuizResultData | null;
  quizReveal: QuizRevealData | null;
  opponentAnswered: boolean;

  // 默契考验
  telepathyQuestion: TelepathyQuestionData | null;
  telepathyReveal: TelepathyRevealData | null;
  telepathyOpponentChose: boolean;

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
  setGameConfig: (c: GameConfig | null) => void;
  setCurrentQuestion: (q: QuestionData | null) => void;
  setQuizResult: (r: QuizResultData | null) => void;
  setQuizReveal: (r: QuizRevealData | null) => void;
  setOpponentAnswered: (v: boolean) => void;
  setTelepathyQuestion: (q: TelepathyQuestionData | null) => void;
  setTelepathyReveal: (r: TelepathyRevealData | null) => void;
  setTelepathyOpponentChose: (v: boolean) => void;
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
  gameConfig: null,
  currentQuestion: null,
  quizResult: null,
  quizReveal: null,
  opponentAnswered: false,
  telepathyQuestion: null,
  telepathyReveal: null,
  telepathyOpponentChose: false,
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
      ...(phase !== "QUIZ" ? { currentQuestion: null, quizResult: null, quizReveal: null, opponentAnswered: false } : {}),
      ...(phase === "WORD_DISPLAY" || phase === "DRAWING" ? { roundResult: null, gameOver: null } : {}),
      // 默契考验：离开揭晓阶段时清理 reveal 数据
      ...(phase !== "QUIZ" ? { telepathyReveal: null, telepathyOpponentChose: false } : {}),
    })),
  setWords: (words) => set({ words }),
  setDrawings: (drawings) => set({ drawings }),
  setGameConfig: (c) => set({ gameConfig: c }),
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
  setTelepathyQuestion: (q) =>
    set({
      telepathyQuestion: q,
      telepathyReveal: null,
      telepathyOpponentChose: false,
    }),
  setTelepathyReveal: (r) => set({ telepathyReveal: r }),
  setTelepathyOpponentChose: (v) => set({ telepathyOpponentChose: v }),
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
      gameConfig: null,
      currentQuestion: null,
      quizResult: null,
      quizReveal: null,
      opponentAnswered: false,
      telepathyQuestion: null,
      telepathyReveal: null,
      telepathyOpponentChose: false,
      roundResult: null,
      gameOver: null,
    }),
}));
