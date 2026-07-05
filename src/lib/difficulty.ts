// 难度配置（前后端共享）
// 前端 import from "@/lib/difficulty"
// 后端 import from "./difficulty.js"

export type Difficulty = "easy" | "normal" | "hard" | "nightmare";

export interface DifficultyConfig {
  /** 档位标识 */
  key: Difficulty;
  /** 显示名称 */
  label: string;
  /** emoji 图标 */
  icon: string;
  /** 看词时间（秒） */
  viewTime: number;
  /** 画图时间（秒） */
  drawTime: number;
  /** 双人模式 WordDisplay 阶段每词时间（秒） */
  wordDuration: number;
  /** 词库筛选：按 category 白名单，空数组表示全词库 */
  categories: string[];
  /** 主题色（tailwind class） */
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
    categories: [], // 全词库
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

export const DIFFICULTY_LIST: DifficultyConfig[] = [
  DIFFICULTY_CONFIGS.easy,
  DIFFICULTY_CONFIGS.normal,
  DIFFICULTY_CONFIGS.hard,
  DIFFICULTY_CONFIGS.nightmare,
];

export const DEFAULT_DIFFICULTY: Difficulty = "normal";

/** 根据难度获取配置 */
export function getDifficultyConfig(d: Difficulty): DifficultyConfig {
  return DIFFICULTY_CONFIGS[d] || DIFFICULTY_CONFIGS.normal;
}
