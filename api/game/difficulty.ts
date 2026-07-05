// 难度配置（后端用）
// 与 src/lib/difficulty.ts 保持同步

export type Difficulty = "easy" | "normal" | "hard" | "nightmare";

export interface DifficultyConfig {
  key: Difficulty;
  label: string;
  icon: string;
  viewTime: number;
  drawTime: number;
  wordDuration: number;
  categories: string[];
  color: string;
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    key: "easy",
    label: "简单",
    icon: "🌱",
    viewTime: 5,
    drawTime: 15,
    wordDuration: 8,
    categories: ["食物", "动物", "物品"],
    color: "bg-mint",
  },
  normal: {
    key: "normal",
    label: "中等",
    icon: "🌿",
    viewTime: 3,
    drawTime: 8,
    wordDuration: 5,
    categories: [],
    color: "bg-sun",
  },
  hard: {
    key: "hard",
    label: "困难",
    icon: "🔥",
    viewTime: 2,
    drawTime: 5,
    wordDuration: 3,
    categories: ["物品", "自然", "交通", "建筑", "人物"],
    color: "bg-coral",
  },
  nightmare: {
    key: "nightmare",
    label: "噩梦",
    icon: "💀",
    viewTime: 1,
    drawTime: 3,
    wordDuration: 2,
    categories: ["建筑", "人物", "物品"],
    color: "bg-ink",
  },
};

export const DEFAULT_DIFFICULTY: Difficulty = "normal";

export function getDifficultyConfig(d: Difficulty): DifficultyConfig {
  return DIFFICULTY_CONFIGS[d] || DIFFICULTY_CONFIGS.normal;
}

export const VALID_DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
