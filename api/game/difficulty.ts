// 难度配置（后端用）
// 与 src/lib/difficulty.ts 保持同步

export type Difficulty = "easy" | "normal" | "hard" | "nightmare";

export interface DifficultyConfig {
  key: Difficulty;
  label: string;
  icon: string;
  categories: string[];
  categoryDesc: string;
  color: string;
}

// 所有难度统一的时间参数
export const VIEW_TIME = 3;
export const DRAW_TIME = 12;
export const WORD_DURATION = 5;

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    key: "easy",
    label: "简单",
    icon: "🌱",
    categories: ["食物", "动物", "物品"],
    categoryDesc: "食物 · 动物 · 物品",
    color: "bg-mint",
  },
  normal: {
    key: "normal",
    label: "中等",
    icon: "🌿",
    categories: [],
    categoryDesc: "全词库随机",
    color: "bg-sun",
  },
  hard: {
    key: "hard",
    label: "困难",
    icon: "🔥",
    categories: ["交通", "建筑", "自然"],
    categoryDesc: "交通 · 建筑 · 自然",
    color: "bg-coral",
  },
  nightmare: {
    key: "nightmare",
    label: "噩梦",
    icon: "💀",
    categories: ["人物", "建筑"],
    categoryDesc: "人物 · 建筑",
    color: "bg-ink",
  },
};

export const DEFAULT_DIFFICULTY: Difficulty = "normal";

export function getDifficultyConfig(d: Difficulty): DifficultyConfig {
  return DIFFICULTY_CONFIGS[d] || DIFFICULTY_CONFIGS.normal;
}

export const VALID_DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
