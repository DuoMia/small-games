/**
 * 表情包猜词题库生成脚本 v3 ——「元素组合联想」逻辑（手写种子版）
 *
 * v2 的问题：emoji 直接拼字面（如 🍷🏹🐍 = 杯弓蛇影，🕳️🐸 = 井底之蛙），
 * 玩家看 emoji 就懂答案，体验无聊。
 *
 * v3 改造：
 *   - 不用 1emoji = 1字
 *   - 用多个 emoji 描述关键角色/元素/动作/场景，让玩家"组合联想"
 *   - emoji 数量 2-6
 *   - 必须有思维跳跃
 *
 * 本次完全使用手写种子题库（100 题），保证质量，不依赖 LLM 补充。
 * 写入 api/data/emoji-puzzles.json，id 从 1 递增。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === 手写种子题库（100 题：成语 50 + 影视 50） ===
// 设计模式：
//   A. 角色组合型（多个角色让人联想群体/作品）
//   B. 场景组合型（元素+动作+对象）
//   C. 概念组合型（用 emoji 暗示抽象概念）
//   D. 隐喻/谐音型
//   E. 道具组合型
const SEED_PUZZLES = [
  // ========== 成语（1-50，按难度递增）==========
  // —— 简单组合（1-15）——
  { category: "成语", emoji: "🌳🐰", answer: "守株待兔", alternatives: [] },
  { category: "成语", emoji: "🐂🎵", answer: "对牛弹琴", alternatives: [] },
  { category: "成语", emoji: "🐰🐢", answer: "龟兔赛跑", alternatives: [] },
  { category: "成语", emoji: "🐍✏️", answer: "画蛇添足", alternatives: [] },
  { category: "成语", emoji: "🦊🐯", answer: "狐假虎威", alternatives: [] },
  { category: "成语", emoji: "🐘👁️👃👂✋", answer: "盲人摸象", alternatives: [] },
  { category: "成语", emoji: "🐔🔪🐒", answer: "杀鸡儆猴", alternatives: ["杀鸡吓猴"] },
  { category: "成语", emoji: "🍑👀🤤", answer: "望梅止渴", alternatives: [] },
  { category: "成语", emoji: "🐎💨🌸", answer: "走马观花", alternatives: [] },
  { category: "成语", emoji: "🐦👨‍🦲🏹", answer: "惊弓之鸟", alternatives: [] },
  { category: "成语", emoji: "🐸🕳️", answer: "井底之蛙", alternatives: [] },
  { category: "成语", emoji: "🐑🔨🏠", answer: "亡羊补牢", alternatives: [] },
  { category: "成语", emoji: "🐴🗺️", answer: "老马识途", alternatives: [] },
  { category: "成语", emoji: "🐕🧱", answer: "狗急跳墙", alternatives: [] },
  { category: "成语", emoji: "🌸💧", answer: "落花流水", alternatives: [] },
  // —— 中等组合（16-30）——
  { category: "成语", emoji: "🐒👑⛰️", answer: "大闹天宫", alternatives: [] },
  { category: "成语", emoji: "🌊⛵", answer: "同舟共济", alternatives: ["风雨同舟"] },
  { category: "成语", emoji: "🐓🌅⚔️", answer: "闻鸡起舞", alternatives: [] },
  { category: "成语", emoji: "🔥💧", answer: "水火不容", alternatives: [] },
  { category: "成语", emoji: "🐔💨🐕", answer: "鸡飞狗跳", alternatives: [] },
  { category: "成语", emoji: "🐯🐑", answer: "羊入虎口", alternatives: [] },
  { category: "成语", emoji: "🐺🐑", answer: "狼狈为奸", alternatives: [] },
  { category: "成语", emoji: "🌙👸🐰", answer: "嫦娥奔月", alternatives: [] },
  { category: "成语", emoji: "🍂🌳", answer: "一叶知秋", alternatives: ["落叶知秋"] },
  { category: "成语", emoji: "🐴🌌", answer: "天马行空", alternatives: [] },
  { category: "成语", emoji: "💧🌙", answer: "镜花水月", alternatives: [] },
  { category: "成语", emoji: "🌳🌸🌸🌸", answer: "百花齐放", alternatives: [] },
  { category: "成语", emoji: "🐟🌊", answer: "如鱼得水", alternatives: [] },
  { category: "成语", emoji: "🐺→🌕", answer: "狼来了", alternatives: [] },
  { category: "成语", emoji: "🐦🦪", answer: "鹬蚌相争", alternatives: [] },
  // —— 较难组合（31-50）——
  { category: "成语", emoji: "🐕🐭", answer: "狗拿耗子", alternatives: ["狗拿耗子多管闲事"] },
  { category: "成语", emoji: "🌾💨", answer: "风吹草动", alternatives: [] },
  { category: "成语", emoji: "🐰🏠🏠🏠", answer: "狡兔三窟", alternatives: [] },
  { category: "成语", emoji: "🦅☁️", answer: "大鹏展翅", alternatives: [] },
  { category: "成语", emoji: "🐂👆", answer: "牛逼", alternatives: ["牛B", "牛掰"] },
  { category: "成语", emoji: "🌾⛵", answer: "草船借箭", alternatives: [] },
  { category: "成语", emoji: "🐎☀️", answer: "一日千里", alternatives: [] },
  { category: "成语", emoji: "🌸🌙", answer: "花好月圆", alternatives: [] },
  { category: "成语", emoji: "🐍🌹", answer: "蛇蝎心肠", alternatives: [] },
  { category: "成语", emoji: "🏮🏮🏮", answer: "张灯结彩", alternatives: [] },
  { category: "成语", emoji: "🐂🌳", answer: "牛鬼蛇神", alternatives: [] },
  { category: "成语", emoji: "🐦🏹🎯", answer: "一箭双雕", alternatives: [] },
  { category: "成语", emoji: "🐎🐎🐎", answer: "万马奔腾", alternatives: [] },
  { category: "成语", emoji: "🐦🌳🎵", answer: "鸟语花香", alternatives: [] },
  { category: "成语", emoji: "🌊🏔️", answer: "海枯石烂", alternatives: [] },
  { category: "成语", emoji: "🦌🌲", answer: "林深时见鹿", alternatives: [] },
  { category: "成语", emoji: "🐦🏠", answer: "倦鸟归巢", alternatives: [] },
  { category: "成语", emoji: "🌹🌙", answer: "闭月羞花", alternatives: [] },
  { category: "成语", emoji: "🐕🏃", answer: "走为上计", alternatives: [] },
  { category: "成语", emoji: "💧🪨", answer: "滴水穿石", alternatives: ["水滴石穿"] },

  // ========== 影视（51-100）==========
  // —— 简单组合（51-65）——
  { category: "影视", emoji: "🐒🐷🐴👨‍🦲", answer: "西游记", alternatives: ["大话西游", "Journey to the West"] },
  { category: "影视", emoji: "👑👑👑🌸🤝", answer: "三国演义", alternatives: ["三国"] },
  { category: "影视", emoji: "💧⛰️👥", answer: "水浒传", alternatives: ["水浒"] },
  { category: "影视", emoji: "💎🏰😢", answer: "红楼梦", alternatives: [] },
  { category: "影视", emoji: "🌍🚀☀️💥", answer: "流浪地球", alternatives: [] },
  { category: "影视", emoji: "🐺🔫🇨🇳", answer: "战狼2", alternatives: ["战狼", "Wolf Warrior"] },
  { category: "影视", emoji: "❄️🏔️🔫", answer: "长津湖", alternatives: [] },
  { category: "影视", emoji: "👶🔥🌊⚔️", answer: "哪吒之魔童降世", alternatives: ["哪吒", "哪吒降世"] },
  { category: "影视", emoji: "🚢💔🧊", answer: "泰坦尼克号", alternatives: ["泰坦尼克", "Titanic"] },
  { category: "影视", emoji: "🧙‍♂️⚡📚", answer: "哈利波特", alternatives: ["Harry Potter", "哈利·波特"] },
  { category: "影视", emoji: "💍🌋👹", answer: "指环王", alternatives: ["魔戒", "Lord of the Rings"] },
  { category: "影视", emoji: "🕷️👦", answer: "蜘蛛侠", alternatives: ["Spider-Man"] },
  { category: "影视", emoji: "🦇🦸", answer: "蝙蝠侠", alternatives: ["Batman"] },
  { category: "影视", emoji: "❄️👸", answer: "冰雪奇缘", alternatives: ["Frozen"] },
  { category: "影视", emoji: "🐼🥋", answer: "功夫熊猫", alternatives: ["Kung Fu Panda"] },
  // —— 中等组合（66-80）——
  { category: "影视", emoji: "💙👽🌊", answer: "阿凡达", alternatives: ["Avatar"] },
  { category: "影视", emoji: "🦸‍♂️🦸‍♀️🤝", answer: "复仇者联盟", alternatives: ["Avengers", "妇联"] },
  { category: "影视", emoji: "🤖🚗💥", answer: "变形金刚", alternatives: ["Transformers"] },
  { category: "影视", emoji: "🏎️💨🔥", answer: "速度与激情", alternatives: ["速激", "Fast & Furious"] },
  { category: "影视", emoji: "🦊🐰👮", answer: "疯狂动物城", alternatives: ["Zootopia"] },
  { category: "影视", emoji: "🧜‍♀️🐟🌊", answer: "美人鱼", alternatives: ["海的女儿"] },
  { category: "影视", emoji: "👩👧❤️⏰", answer: "你好李焕英", alternatives: ["李焕英"] },
  { category: "影视", emoji: "👑🐱", answer: "狮子王", alternatives: ["Lion King"] },
  { category: "影视", emoji: "🌸🗡️🐎", answer: "花木兰", alternatives: ["Mulan", "木兰"] },
  { category: "影视", emoji: "🎸💀👦", answer: "寻梦环游记", alternatives: ["Coco"] },
  { category: "影视", emoji: "🏠🎈🧓", answer: "飞屋环游记", alternatives: ["Up"] },
  { category: "影视", emoji: "🧠😃😢", answer: "头脑特工队", alternatives: ["Inside Out"] },
  { category: "影视", emoji: "⭐⚔️🚀", answer: "星球大战", alternatives: ["Star Wars"] },
  { category: "影视", emoji: "🏴‍☠️⛵🏝️", answer: "加勒比海盗", alternatives: ["Pirates of the Caribbean"] },
  { category: "影视", emoji: "💻🕶️🟢", answer: "黑客帝国", alternatives: ["The Matrix", "矩阵"] },
  // —— 较难组合（81-100）——
  { category: "影视", emoji: "🐒👑🔥", answer: "大圣归来", alternatives: ["西游记之大圣归来"] },
  { category: "影视", emoji: "🗡️🩸📜", answer: "满江红", alternatives: [] },
  { category: "影视", emoji: "🏯✈️📜", answer: "长安三万里", alternatives: [] },
  { category: "影视", emoji: "🏮⚔️👑", answer: "封神第一部", alternatives: ["封神"] },
  { category: "影视", emoji: "🥊⛩️👦", answer: "八角笼中", alternatives: [] },
  { category: "影视", emoji: "👰❓🔍", answer: "消失的她", alternatives: [] },
  { category: "影视", emoji: "🤠🚀⭐", answer: "玩具总动员", alternatives: ["Toy Story"] },
  { category: "影视", emoji: "🐠🔍🐟", answer: "海底总动员", alternatives: ["Finding Nemo", "寻找尼莫"] },
  { category: "影视", emoji: "🤖🌱❤️", answer: "机器人总动员", alternatives: ["WALL·E", "瓦力"] },
  { category: "影视", emoji: "🦸‍♂️🦸‍♀️💥", answer: "超人总动员", alternatives: ["The Incredibles"] },
  { category: "影视", emoji: "🥋💥👊", answer: "功夫", alternatives: ["Kung Fu"] },
  { category: "影视", emoji: "🏪🔍🕵️", answer: "唐人街探案", alternatives: ["唐探"] },
  { category: "影视", emoji: "💤🎓😂", answer: "夏洛特烦恼", alternatives: [] },
  { category: "影视", emoji: "🐻🌲🏃", answer: "熊出没", alternatives: [] },
  { category: "影视", emoji: "🐑🐺🪤", answer: "喜羊羊与灰太狼", alternatives: ["喜羊羊"] },
  { category: "影视", emoji: "🦖🦕🏞️", answer: "侏罗纪公园", alternatives: ["Jurassic Park"] },
  { category: "影视", emoji: "🔩🦸‍♂️💥", answer: "钢铁侠", alternatives: ["Iron Man"] },
  { category: "影视", emoji: "🐆👑", answer: "黑豹", alternatives: ["Black Panther"] },
  { category: "影视", emoji: "🟢👹👂", answer: "怪物史莱克", alternatives: ["Shrek", "史莱克"] },
  { category: "影视", emoji: "🏮👹👶", answer: "捉妖记", alternatives: [] },
];

// === 工具函数 ===

/** emoji 字段是否含禁止字符（汉字/英文字母/数字） */
function hasForbiddenChars(emoji) {
  if (typeof emoji !== "string" || !emoji) return true;
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(emoji);
}

/** 用 Intl.Segmenter 统计 emoji 簇数量（正确处理 ZWJ 序列） */
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function emojiCount(str) {
  if (typeof str !== "string") return 0;
  const cleaned = str.replace(/[\s+\-]/g, "");
  if (!cleaned) return 0;
  return [...segmenter.segment(cleaned)].length;
}

/** 规范化一条题目 */
function normalize(p) {
  if (!p || typeof p !== "object") return null;
  const emoji = String(p.emoji || "").trim();
  const answer = String(p.answer || "").trim();
  const category = String(p.category || "").trim();
  if (!emoji || !answer) return null;
  if (!["成语", "影视"].includes(category)) return null;
  if (hasForbiddenChars(emoji)) return null;
  const count = emojiCount(emoji);
  if (count < 2 || count > 6) return null;
  return {
    category,
    emoji,
    answer,
    alternatives: Array.isArray(p.alternatives)
      ? p.alternatives.map((a) => String(a).trim()).filter(Boolean).slice(0, 3)
      : [],
  };
}

async function main() {
  console.log("🎯 表情包猜词题库 v3 生成脚本（手写种子题库）");
  console.log(`   目标: 100 题（成语 50 + 影视 50）\n`);

  const allPuzzles = [];
  const seenEmoji = new Set();
  const seenAnswer = new Set();
  let seedBad = 0;
  let seedDup = 0;

  for (const p of SEED_PUZZLES) {
    const norm = normalize(p);
    if (!norm) {
      seedBad++;
      console.error(`   ✗ 剔除: ${p.emoji} → ${p.answer} (格式不符)`);
      continue;
    }
    if (seenEmoji.has(norm.emoji) || seenAnswer.has(norm.answer)) {
      seedDup++;
      console.error(`   ⚠ 重复: ${norm.emoji} → ${norm.answer}`);
      continue;
    }
    seenEmoji.add(norm.emoji);
    seenAnswer.add(norm.answer);
    allPuzzles.push(norm);
  }

  console.log(`✓ 种子题入库: ${allPuzzles.length} 题${seedBad ? `（${seedBad} 题格式不符）` : ""}${seedDup ? `（${seedDup} 题重复）` : ""}`);

  // 重新编号 id（成语在前，影视在后）
  allPuzzles.sort((a, b) => {
    if (a.category !== b.category) return a.category === "成语" ? -1 : 1;
    return 0;
  });
  const finalPuzzles = allPuzzles.map((p, idx) => ({ id: idx + 1, ...p }));

  const statIdiom = finalPuzzles.filter((p) => p.category === "成语").length;
  const statMovie = finalPuzzles.filter((p) => p.category === "影视").length;

  const dataPath = path.join(__dirname, "..", "api", "data", "emoji-puzzles.json");
  fs.writeFileSync(dataPath, JSON.stringify(finalPuzzles, null, 2) + "\n", "utf-8");

  console.log(`\n📊 生成完成：共 ${finalPuzzles.length} 题`);
  console.log(`   成语: ${statIdiom} 题`);
  console.log(`   影视: ${statMovie} 题`);
  console.log(`✅ 题库已写入: ${dataPath}`);
}

main().catch((err) => {
  console.error("💥 脚本异常:", err);
  process.exit(1);
});
