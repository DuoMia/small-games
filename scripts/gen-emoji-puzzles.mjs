/**
 * AI 表情包猜词题库重做脚本
 * 用智谱 GLM-4-Flash（免费）重新生成 emoji-puzzles.json
 *
 * 解决旧题库问题：很多 emoji 里直接混了文字（如"🐲腾🐯跃"、"❄️👸Snowman"），
 * 玩家看到文字就知道答案，不用思考。本脚本生成纯 emoji 题库。
 *
 * 用法：
 *   $env:GLM_API_KEY="你的key"; node scripts/gen-emoji-puzzles.mjs
 *
 * 或在 scripts/ 目录下创建 .env 文件（已被 .gitignore 忽略）：
 *   GLM_API_KEY=你的key
 *
 * 生成后会覆盖写入 api/data/emoji-puzzles.json（id 从 1 重新编号）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从环境变量或 .env 文件读取 API key
let API_KEY = process.env.GLM_API_KEY;
if (!API_KEY) {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    const match = envContent.match(/GLM_API_KEY\s*=\s*(.+)/);
    if (match) API_KEY = match[1].trim();
  }
}
if (!API_KEY) {
  console.error("❌ 未找到 GLM_API_KEY，请设置环境变量或创建 scripts/.env");
  console.error("   PowerShell: $env:GLM_API_KEY=\"你的key\"; node scripts/gen-emoji-puzzles.mjs");
  process.exit(1);
}

const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL = "glm-4-flash";
const BATCH_SIZE = 10; // 每批 10 题
const TOTAL_BATCHES = 7; // 共 7 批，目标 50-80 题（去重后）
const MAX_RETRIES = 2; // API 失败重试 2 次

// 10 个类别，每批轮换重点类别，保证覆盖度
const CATEGORIES = [
  "成语",
  "电影",
  "歌曲",
  "动物",
  "食物",
  "城市",
  "网络梗",
  "节日",
  "日用品",
  "自然现象",
];

/** emoji 字段是否包含禁止字符（汉字/英文字母/数字） */
function hasForbiddenChars(emoji) {
  if (typeof emoji !== "string") return true;
  // 拒绝包含汉字、英文字母、数字的 emoji（只允许 emoji 符号与连接符 + - 空格）
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(emoji);
}

/** 调用 GLM（带重试）。返回解析后的 JSON 对象。 */
async function callGLM(messages, temperature, retryTag = "") {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature,
          response_format: { type: "json_object" },
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API 请求失败 (${response.status}): ${errText}`);
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("API 返回为空");
      return JSON.parse(content);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        console.error(`   ⚠${retryTag} 第 ${attempt + 1} 次失败: ${err.message}，重试中...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/** 生成一批 emoji 谜题 */
async function generateBatch(batchIdx, focusCategories) {
  const focusText = focusCategories.join("、");

  const prompt = `你是表情包猜词游戏的题目生成器。请生成 ${BATCH_SIZE} 道题目，类别优先从这些中选：${focusText}。
完整可选类别：${CATEGORIES.join("、")}。

【最重要要求 —— 违反即作废】
emoji 字段只能包含 emoji 字符和连接符（+、-、空格），绝对不能包含任何汉字、英文字母、数字、标点符号。
例如 ❌ 错误：🐲腾🐯跃、❄️👸Snowman、🐴功夫（混入了文字）
例如 ✅ 正确：🐲🐯🔥、❄️👸❄️、🐴🥋、🦁👑、🍔🍟🥤

其他要求：
1. emoji 组合要能让人联想到答案，但需要一点思考，不能一看就懂
2. 答案简洁（2-8 字），是大众熟知的词
3. alternatives 给 1-3 个同义/近义答案（可为空数组）
4. 题目要可猜，不要过于冷门
5. 每题类别从上面的可选类别中选

请严格返回以下 JSON 格式（不要有任何其他文字）：
{"puzzles":[{"category":"类别","emoji":"纯emoji","answer":"答案","alternatives":["alt1","alt2"]}]}`;

  const messages = [
    { role: "system", content: "你是一个 JSON 生成器，只返回有效的 JSON，不要任何其他文字。" },
    { role: "user", content: prompt },
  ];

  const parsed = await callGLM(messages, 0.9, `[batch ${batchIdx + 1}]`);
  const list = Array.isArray(parsed.puzzles) ? parsed.puzzles : [];
  return list
    .filter((p) => p && typeof p.emoji === "string" && typeof p.answer === "string")
    .map((p) => ({
      category: String(p.category || "").trim(),
      emoji: p.emoji.trim(),
      answer: p.answer.trim(),
      alternatives: Array.isArray(p.alternatives)
        ? p.alternatives.map((a) => String(a).trim()).filter(Boolean).slice(0, 3)
        : [],
    }));
}

async function main() {
  console.log("🎯 表情包猜词题库重做脚本启动");
  console.log(`   模型: ${MODEL}`);
  console.log(`   目标: ${TOTAL_BATCHES} 批 × ${BATCH_SIZE} 题 = ${TOTAL_BATCHES * BATCH_SIZE} 题（去重+过滤后 50-80 题）\n`);

  const allPuzzles = [];
  const seenEmoji = new Set(); // emoji 去重
  const seenAnswer = new Set(); // 答案去重
  let filteredOut = 0;

  for (let i = 0; i < TOTAL_BATCHES; i++) {
    // 每批轮换 2-3 个重点类别
    const focus = [
      CATEGORIES[(i * 3) % CATEGORIES.length],
      CATEGORIES[(i * 3 + 1) % CATEGORIES.length],
      CATEGORIES[(i * 3 + 2) % CATEGORIES.length],
    ];
    console.log(`[${i + 1}/${TOTAL_BATCHES}] 生成批次（重点类别：${focus.join("、")}）...`);
    try {
      const batch = await generateBatch(i, focus);
      let added = 0;
      let badEmoji = 0;
      for (const p of batch) {
        // 过滤含禁止字符的 emoji
        if (hasForbiddenChars(p.emoji)) {
          badEmoji++;
          filteredOut++;
          continue;
        }
        // 去重
        if (seenEmoji.has(p.emoji)) continue;
        if (seenAnswer.has(p.answer)) continue;
        seenEmoji.add(p.emoji);
        seenAnswer.add(p.answer);
        allPuzzles.push(p);
        added++;
      }
      console.log(`   ✓ 本批 ${batch.length} 题，新增 ${added} 题${badEmoji ? `（过滤 ${badEmoji} 题含文字）` : ""}（累计 ${allPuzzles.length}）`);
    } catch (err) {
      console.error(`   ✗ 失败: ${err.message}`);
    }
    // 避免 API 限流
    await new Promise((r) => setTimeout(r, 500));
  }

  // 重新编号 id（从 1 开始）
  const finalPuzzles = allPuzzles.map((p, idx) => ({ id: idx + 1, ...p }));

  const dataPath = path.join(__dirname, "..", "api", "data", "emoji-puzzles.json");
  fs.writeFileSync(dataPath, JSON.stringify(finalPuzzles, null, 2) + "\n", "utf-8");

  console.log(`\n📊 生成完成：共 ${finalPuzzles.length} 题（过滤 ${filteredOut} 题含文字/重复）`);
  console.log(`✅ 题库已重写：${dataPath}`);

  // 分类统计
  const stats = {};
  finalPuzzles.forEach((p) => {
    stats[p.category] = (stats[p.category] || 0) + 1;
  });
  console.log("   分类统计：", stats);
}

main().catch((err) => {
  console.error("💥 脚本异常:", err);
  process.exit(1);
});
