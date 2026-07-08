/**
 * 表情包猜词题库质量自检脚本
 *
 * 检查项：
 *   1. emoji 数量 2-6
 *   2. emoji 字段不含汉字/英文字母/数字
 *   3. 答案/emoji 不重复
 *   4. category 必须是 "成语" 或 "影视"
 *   5. 必填字段非空
 *   6. 分布统计（每类题数、emoji 数量分布、答案长度分布等）
 *
 * 用法：node scripts/verify-emoji-quality.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "..", "api", "data", "emoji-puzzles.json");

// 读取题库
const raw = fs.readFileSync(dataPath, "utf-8");
const puzzles = JSON.parse(raw);

console.log("═══════════════════════════════════════════════");
console.log("📋 表情包猜词题库质量自检报告");
console.log("═══════════════════════════════════════════════\n");

// 工具函数
function hasForbiddenChars(str) {
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(str);
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function emojiCount(str) {
  const cleaned = str.replace(/[\s+\-]/g, "");
  return [...segmenter.segment(cleaned)].length;
}

// 1. 基础统计
const total = puzzles.length;
const idiomCount = puzzles.filter((p) => p.category === "成语").length;
const movieCount = puzzles.filter((p) => p.category === "影视").length;

console.log("📊 基础统计");
console.log(`   总题数: ${total}`);
console.log(`   成语: ${idiomCount} 题`);
console.log(`   影视: ${movieCount} 题\n`);

// 2. 检查必填字段
const fieldIssues = [];
for (const p of puzzles) {
  if (!p.id) fieldIssues.push(`id 缺失: ${JSON.stringify(p).slice(0, 50)}`);
  if (!p.category) fieldIssues.push(`category 缺失 (id=${p.id})`);
  if (!p.emoji) fieldIssues.push(`emoji 缺失 (id=${p.id})`);
  if (!p.answer) fieldIssues.push(`answer 缺失 (id=${p.id})`);
  if (!Array.isArray(p.alternatives)) fieldIssues.push(`alternatives 非数组 (id=${p.id})`);
  if (p.category && !["成语", "影视"].includes(p.category)) {
    fieldIssues.push(`category 非法 (id=${p.id}): ${p.category}`);
  }
}

console.log("🔍 必填字段检查");
console.log(`   问题数: ${fieldIssues.length}`);
if (fieldIssues.length > 0) {
  fieldIssues.slice(0, 5).forEach((s) => console.log(`   ⚠ ${s}`));
  if (fieldIssues.length > 5) console.log(`   ...还有 ${fieldIssues.length - 5} 个`);
}
console.log();

// 3. emoji 纯度检查
const forbiddenPuzzles = [];
for (const p of puzzles) {
  if (hasForbiddenChars(p.emoji)) {
    forbiddenPuzzles.push({ id: p.id, emoji: p.emoji, answer: p.answer });
  }
}

console.log("🧪 emoji 纯度（是否含汉字/字母/数字）");
console.log(`   不纯 emoji 数: ${forbiddenPuzzles.length}`);
if (forbiddenPuzzles.length > 0) {
  forbiddenPuzzles.slice(0, 5).forEach((p) =>
    console.log(`   ⚠ id=${p.id} "${p.emoji}" → ${p.answer}`)
  );
}
console.log();

// 4. emoji 数量分布
const countDist = {};
let countIssues = 0;
for (const p of puzzles) {
  const c = emojiCount(p.emoji);
  countDist[c] = (countDist[c] || 0) + 1;
  if (c < 2 || c > 6) countIssues++;
}

console.log("🔢 emoji 数量分布（每题 emoji 簇数）");
Object.keys(countDist)
  .sort((a, b) => Number(a) - Number(b))
  .forEach((k) => console.log(`   ${k} 个: ${countDist[k]} 题`));
console.log(`   数量异常 (<2 或 >6): ${countIssues} 题\n`);

// 5. 答案/emoji 重复检查
const emojiSeen = new Map();
const answerSeen = new Map();
const dupEmoji = [];
const dupAnswer = [];

for (const p of puzzles) {
  if (emojiSeen.has(p.emoji)) {
    dupEmoji.push(`${p.emoji} (id=${p.id} & id=${emojiSeen.get(p.emoji)})`);
  } else {
    emojiSeen.set(p.emoji, p.id);
  }
  if (answerSeen.has(p.answer)) {
    dupAnswer.push(`${p.answer} (id=${p.id} & id=${answerSeen.get(p.answer)})`);
  } else {
    answerSeen.set(p.answer, p.id);
  }
}

console.log("🔁 重复检查");
console.log(`   emoji 重复: ${dupEmoji.length}`);
if (dupEmoji.length > 0) dupEmoji.slice(0, 5).forEach((s) => console.log(`   ⚠ ${s}`));
console.log(`   答案重复: ${dupAnswer.length}`);
if (dupAnswer.length > 0) dupAnswer.slice(0, 5).forEach((s) => console.log(`   ⚠ ${s}`));
console.log();

// 6. 答案长度分布
const answerLenDist = {};
for (const p of puzzles) {
  const l = p.answer.length;
  answerLenDist[l] = (answerLenDist[l] || 0) + 1;
}

console.log("📏 答案长度分布（字符数）");
Object.keys(answerLenDist)
  .sort((a, b) => Number(a) - Number(b))
  .forEach((k) => console.log(`   ${k} 字: ${answerLenDist[k]} 题`));
console.log();

// 7. alternatives 统计
const withAlt = puzzles.filter((p) => p.alternatives && p.alternatives.length > 0).length;
const tooManyAlt = puzzles.filter((p) => p.alternatives && p.alternatives.length > 3).length;

console.log("🏷 别名 (alternatives) 统计");
console.log(`   有别名的题: ${withAlt} / ${total}`);
console.log(`   别名超 3 个的题: ${tooManyAlt}`);
console.log();

// 8. id 连续性
const ids = puzzles.map((p) => p.id).sort((a, b) => a - b);
let idContinuous = true;
for (let i = 0; i < ids.length; i++) {
  if (ids[i] !== i + 1) {
    idContinuous = false;
    break;
  }
}

console.log("🆔 id 连续性检查");
console.log(`   id 范围: ${ids[0]} - ${ids[ids.length - 1]}`);
console.log(`   是否连续 1..N: ${idContinuous ? "✓ 是" : "✗ 否"}\n`);

// 9. 综合评级
const allPass =
  total === 100 &&
  idiomCount === 50 &&
  movieCount === 50 &&
  fieldIssues.length === 0 &&
  forbiddenPuzzles.length === 0 &&
  countIssues === 0 &&
  dupEmoji.length === 0 &&
  dupAnswer.length === 0 &&
  tooManyAlt === 0 &&
  idContinuous;

console.log("═══════════════════════════════════════════════");
console.log(allPass ? "✅ 综合评级: 优秀 — 所有检查通过" : "⚠️  综合评级: 有问题 — 见上方");
console.log("═══════════════════════════════════════════════");

// 退出码
process.exit(allPass ? 0 : 1);
