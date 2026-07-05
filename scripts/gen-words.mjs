/**
 * AI 词库生成脚本
 * 用智谱 GLM-4-Flash（免费）批量生成适合画画的词语
 *
 * 用法：
 *   $env:GLM_API_KEY="你的key"; node scripts/gen-words.mjs
 *
 * 或在 scripts/ 目录下创建 .env 文件（已被 .gitignore 忽略）：
 *   GLM_API_KEY=你的key
 *
 * 生成后会自动去重并追加到 api/data/words.json
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
  console.error("   PowerShell: $env:GLM_API_KEY=\"你的key\"; node scripts/gen-words.mjs");
  process.exit(1);
}

const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL = "glm-4-flash";
const BATCH_SIZE = 50; // 每次生成 50 个词
const TOTAL_BATCHES = 12; // 共 12 批，目标 600 个词

// 7 个类别，按画作难度分配生成数量
const CATEGORY_PROMPTS = [
  { category: "食物", count: 4, examples: "苹果、蛋糕、汉堡、面条、饺子、寿司、冰淇淋" },
  { category: "动物", count: 4, examples: "猫、大象、蝴蝶、鲨鱼、狮子、企鹅、老鹰" },
  { category: "物品", count: 4, examples: "雨伞、钥匙、眼镜、闹钟、剪刀、灯泡、书包" },
  { category: "交通", count: 4, examples: "自行车、飞机、潜艇、马车、消防车、热气球、缆车" },
  { category: "建筑", count: 4, examples: "教堂、金字塔、长城、城堡、灯塔、风车、冰屋" },
  { category: "人物", count: 4, examples: "公主、厨师、消防员、画家、魔术师、国王、护士" },
  { category: "自然", count: 4, examples: "彩虹、瀑布、火山、闪电、雪山、沙漠、极光" },
];

/** 读取现有词库，用于去重 */
function loadExistingWords() {
  const wordsPath = path.join(__dirname, "..", "api", "data", "words.json");
  const existing = JSON.parse(fs.readFileSync(wordsPath, "utf-8"));
  return { existing, wordsPath };
}

/** 调用 GLM API 生成一批词语 */
async function generateBatch(category, examples) {
  const prompt = `你是画画猜词游戏的词语生成器。请生成适合画画的"${category}"类词语。

要求：
1. 生成 50 个不同的词语
2. 每个词语必须是一个名词，适合用简笔画表达
3. 词语要常见，但不能太简单（避免"水"、"石头"这种过于简单的）
4. 每个词语附带 1-3 个同义词或近义词
5. 参考风格（不要重复这些）：${examples}

请严格返回以下 JSON 格式（不要有任何其他文字）：
{"words":[{"word":"词语","synonyms":["同义词1","同义词2"],"category":"${category}"}]}`;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "你是一个JSON生成器，只返回有效的JSON，不要任何其他文字。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
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

  const parsed = JSON.parse(content);
  return parsed.words || [];
}

async function main() {
  console.log("🎯 AI 词库生成脚本启动");
  console.log(`   模型: ${MODEL}`);
  console.log(`   目标: ${CATEGORY_PROMPTS.length} 类 × ${BATCH_SIZE} 词 = ${CATEGORY_PROMPTS.length * BATCH_SIZE} 词\n`);

  const { existing, wordsPath } = loadExistingWords();
  const existingWords = new Set(existing.map((w) => w.word));
  console.log(`📖 现有词库: ${existing.length} 个词\n`);

  const allNew = [];
  let batchNum = 0;

  for (const { category, count, examples } of CATEGORY_PROMPTS) {
    for (let i = 0; i < count; i++) {
      batchNum++;
      console.log(`[${batchNum}/${TOTAL_BATCHES}] 生成 ${category} 第 ${i + 1}/${count} 批...`);
      try {
        const words = await generateBatch(category, examples);
        let added = 0;
        for (const w of words) {
          if (!w.word || existingWords.has(w.word) || allNew.some((n) => n.word === w.word)) {
            continue;
          }
          // 规范化
          const entry = {
            word: w.word,
            synonyms: Array.isArray(w.synonyms) ? w.synonyms.slice(0, 3) : [],
            category: category,
          };
          allNew.push(entry);
          existingWords.add(w.word);
          added++;
        }
        console.log(`   ✓ 新增 ${added} 个（累计 ${allNew.length}）`);
      } catch (err) {
        console.error(`   ✗ 失败: ${err.message}`);
      }
      // 避免 API 限流
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n📊 生成完成：共 ${allNew.length} 个新词`);

  // 合并并写入
  const merged = [...existing, ...allNew];
  fs.writeFileSync(wordsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  // 统计
  const stats = {};
  merged.forEach((w) => {
    stats[w.category] = (stats[w.category] || 0) + 1;
  });
  console.log(`\n✅ 词库已更新：${existing.length} → ${merged.length} 个词`);
  console.log("   分类统计：", stats);
}

main().catch((err) => {
  console.error("💥 脚本异常:", err);
  process.exit(1);
});
