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
  /** 词库筛选：按 category 白名单，空数组表示全词库 */
  categories: string[];
  /** 词库筛选说明（给玩家看的） */
  categoryDesc: string;
  /** 主题色（tailwind class） */
  color: string;
}

// 所有难度统一的时间参数（难度只影响词语难度，不影响时间）
export const VIEW_TIME = 3; // 看词3秒
export const DRAW_TIME = 12; // 画图12秒
export const WORD_DURATION = 5; // 双人模式每词展示5秒

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    key: "easy",
    label: "简单",
    icon: "🌱",
    // 食物/动物/物品：具象、形状简单，最容易画
    categories: ["食物", "动物", "物品"],
    categoryDesc: "食物 · 动物 · 物品",
    color: "bg-mint",
  },
  normal: {
    key: "normal",
    label: "中等",
    icon: "🌿",
    categories: [], // 全词库
    categoryDesc: "全词库随机",
    color: "bg-sun",
  },
  hard: {
    key: "hard",
    label: "困难",
    icon: "🔥",
    // 交通/建筑/自然：结构复杂，难画
    categories: ["交通", "建筑", "自然"],
    categoryDesc: "交通 · 建筑 · 自然",
    color: "bg-coral",
  },
  nightmare: {
    key: "nightmare",
    label: "噩梦",
    icon: "💀",
    // 人物/建筑：最难画，五官比例、结构细节
    categories: ["人物", "建筑"],
    categoryDesc: "人物 · 建筑",
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
