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
  HeartStateData,
  HeartResultData,
  HeartGameOverData,
  CoOpStroke,
  CoOpPromptData,
  CoOpTimeData,
  CoOpResultData,
  CoOpOrientation,
  EmojiQuestionData,
  EmojiRevealData,
  DaVinciStateData,
  DaVinciResultData,
  DaVinciGameOverData,
} from "@/lib/types";

interface GameState {
  // 连接
  connected: boolean;
  myId: string | null;

  // 房间
  room: RoomView | null;
  error: string | null;
  publicRooms: RoomView[]; // 大厅公开房间列表

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

  // 德国心脏病
  heartState: HeartStateData | null;
  heartResult: HeartResultData | null;
  heartGameOver: HeartGameOverData | null;

  // 合作画画（同时画 + AI 评分）
  coOpPrompt: CoOpPromptData | null;
  coOpTimeLeft: number; // 剩余时间（秒）
  coOpOrientation: CoOpOrientation; // 画布方向
  coOpIncomingStroke: CoOpStroke | null; // 对方正在画的笔画
  coOpStrokes: CoOpStroke[]; // 已完成的所有笔画
  coOpResult: CoOpResultData | null;
  coOpAIJudging: boolean; // AI 评分中

  // 表情包猜词
  emojiQuestion: EmojiQuestionData | null;
  emojiOpponentAnswered: boolean;
  emojiReveal: EmojiRevealData | null;

  // 达芬奇密码
  dvState: DaVinciStateData | null;
  dvResult: DaVinciResultData | null;
  dvGameOver: DaVinciGameOverData | null;
  // 对方摸牌动画提示（仅对方摸了一张牌，颜色已知）
  dvOppDrewColor: "black" | "white" | null;
  // 自己摸牌动画（摸了一张新牌，等待查看）
  dvSelfDrewCard: { color: "black" | "white"; number: number } | null;
  dvPassedPlayerId: string | null;

  // 结算
  roundResult: RoundResultData | null;
  gameOver: GameOverData | null;

  // Actions
  setConnected: (v: boolean) => void;
  setMyId: (id: string) => void;
  setRoom: (room: RoomView | null) => void;
  setError: (msg: string | null) => void;
  setPublicRooms: (rooms: RoomView[]) => void;
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
  setHeartState: (s: HeartStateData | null) => void;
  setHeartResult: (r: HeartResultData | null) => void;
  setHeartGameOver: (g: HeartGameOverData | null) => void;
  // 合作画画
  setCoOpPrompt: (p: CoOpPromptData | null) => void;
  setCoOpTimeLeft: (n: number) => void;
  setCoOpOrientation: (o: CoOpOrientation) => void;
  setCoOpIncomingStroke: (s: CoOpStroke | null) => void;
  appendCoOpStroke: (s: CoOpStroke) => void;
  setCoOpStrokes: (s: CoOpStroke[]) => void;
  setCoOpResult: (r: CoOpResultData | null) => void;
  setCoOpAIJudging: (v: boolean) => void;
  // 表情包猜词
  setEmojiQuestion: (q: EmojiQuestionData | null) => void;
  setEmojiOpponentAnswered: () => void;
  setEmojiReveal: (r: EmojiRevealData | null) => void;
  // 达芬奇密码
  setDaVinciState: (s: DaVinciStateData | null) => void;
  setDaVinciResult: (r: DaVinciResultData | null) => void;
  setDaVinciGameOver: (g: DaVinciGameOverData | null) => void;
  setDvOppDrewColor: (c: "black" | "white" | null) => void;
  setDvSelfDrewCard: (c: { color: "black" | "white"; number: number } | null) => void;
  setDvPassedPlayerId: (id: string | null) => void;
  setRoundResult: (r: RoundResultData | null) => void;
  setGameOver: (g: GameOverData | null) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  connected: false,
  myId: null,
  room: null,
  error: null,
  publicRooms: [],
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
  heartState: null,
  heartResult: null,
  heartGameOver: null,
  // 合作画画
  coOpPrompt: null,
  coOpTimeLeft: 90,
  coOpOrientation: "landscape",
  coOpIncomingStroke: null,
  coOpStrokes: [],
  coOpResult: null,
  coOpAIJudging: false,
  // 表情包猜词
  emojiQuestion: null,
  emojiOpponentAnswered: false,
  emojiReveal: null,
  // 达芬奇密码
  dvState: null,
  dvResult: null,
  dvGameOver: null,
  dvOppDrewColor: null,
  dvSelfDrewCard: null,
  dvPassedPlayerId: null,
  roundResult: null,
  gameOver: null,

  setConnected: (v) => set({ connected: v }),
  setMyId: (id) => set({ myId: id }),
  setRoom: (room) => set({ room, error: null }),
  setError: (msg) => set({ error: msg }),
  setPublicRooms: (rooms) => set({ publicRooms: rooms }),
  setPhase: (phase, round) =>
    set((s) => ({
      phase,
      currentRound: round ?? s.currentRound,
      ...(phase !== "QUIZ" ? { currentQuestion: null, quizResult: null, quizReveal: null, opponentAnswered: false } : {}),
      ...(phase === "WORD_DISPLAY" || phase === "DRAWING" ? { roundResult: null, gameOver: null, heartGameOver: null, dvGameOver: null, coOpResult: null } : {}),
      // 默契考验：离开揭晓阶段时清理 reveal 数据
      ...(phase !== "QUIZ" ? { telepathyReveal: null, telepathyOpponentChose: false } : {}),
      // 表情包猜词：离开揭晓阶段时清理 reveal 数据
      ...(phase !== "QUIZ" ? { emojiReveal: null, emojiOpponentAnswered: false } : {}),
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
  setHeartState: (s) => set({ heartState: s, heartResult: null, heartGameOver: null }),
  setHeartResult: (r) => set({ heartResult: r }),
  setHeartGameOver: (g) => set({ heartGameOver: g }),
  // 合作画画
  setCoOpPrompt: (p) =>
    set({
      coOpPrompt: p,
      coOpTimeLeft: 90,
      coOpOrientation: p?.orientation ?? "landscape",
      coOpIncomingStroke: null,
      coOpStrokes: [],
      coOpResult: null,
      coOpAIJudging: false,
    }),
  setCoOpTimeLeft: (n) => set({ coOpTimeLeft: n }),
  setCoOpOrientation: (o) => set({ coOpOrientation: o }),
  setCoOpIncomingStroke: (s) => set({ coOpIncomingStroke: s }),
  appendCoOpStroke: (s) =>
    set((st) => ({ coOpStrokes: [...st.coOpStrokes, s], coOpIncomingStroke: null })),
  setCoOpStrokes: (s) => set({ coOpStrokes: s }),
  setCoOpResult: (r) => set({ coOpResult: r }),
  setCoOpAIJudging: (v) => set({ coOpAIJudging: v }),
  // 表情包猜词
  setEmojiQuestion: (q) =>
    set({
      emojiQuestion: q,
      emojiOpponentAnswered: false,
      emojiReveal: null,
    }),
  setEmojiOpponentAnswered: () => set({ emojiOpponentAnswered: true }),
  setEmojiReveal: (r) => set({ emojiReveal: r }),
  // 达芬奇密码
  setDaVinciState: (s) =>
    set({
      dvState: s,
      dvResult: null,
      dvGameOver: null,
      dvOppDrewColor: null,
      dvSelfDrewCard: null,
      dvPassedPlayerId: null,
    }),
  setDaVinciResult: (r) => set({ dvResult: r }),
  setDaVinciGameOver: (g) => set({ dvGameOver: g }),
  setDvOppDrewColor: (c) => set({ dvOppDrewColor: c }),
  setDvSelfDrewCard: (c) => set({ dvSelfDrewCard: c }),
  setDvPassedPlayerId: (id) => set({ dvPassedPlayerId: id }),
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
      heartState: null,
      heartResult: null,
      heartGameOver: null,
      coOpPrompt: null,
      coOpTimeLeft: 90,
      coOpOrientation: "landscape",
      coOpIncomingStroke: null,
      coOpStrokes: [],
      coOpResult: null,
      coOpAIJudging: false,
      emojiQuestion: null,
      emojiOpponentAnswered: false,
      emojiReveal: null,
      dvState: null,
      dvResult: null,
      dvGameOver: null,
      dvOppDrewColor: null,
      dvSelfDrewCard: null,
      dvPassedPlayerId: null,
      roundResult: null,
      gameOver: null,
    }),
}));
