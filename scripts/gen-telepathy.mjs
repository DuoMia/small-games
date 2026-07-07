/**
 * AI 默契考验题目扩展脚本
 * 用智谱 GLM-4-Flash（免费）为每个题包补充新题目（15 → 30 题）
 *
 * 用法：
 *   $env:GLM_API_KEY="你的key"; node scripts/gen-telepathy.mjs
 *
 * 或在 scripts/ 目录下创建 .env 文件（已被 .gitignore 忽略）：
 *   GLM_API_KEY=你的key
 *
 * 生成后会合并写入 api/data/telepathy-questions.json（保留原题，追加新题）
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
  console.error("   PowerShell: $env:GLM_API_KEY=\"你的key\"; node scripts/gen-telepathy.mjs");
  process.exit(1);
}

const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL = "glm-4-flash";
const NEW_PER_PACK = 15; // 每个题包补充 15 题（15 → 30）
const MAX_RETRIES = 2; // API 失败重试 2 次

/** 读取现有题库 */
function loadExistingPacks() {
  const dataPath = path.join(__dirname, "..", "api", "data", "telepathy-questions.json");
  const packs = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  return { packs, dataPath };
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

/** 为一个题包生成新题目 */
async function generateForPack(pack) {
  const existingList = pack.questions
    .map((q) => `- ${q.question}`)
    .join("\n");

  const prompt = `你是默契考验游戏的题目生成器。请为"${pack.name}"题包生成 ${NEW_PER_PACK} 道新题目。

要求：
1. 每题必须有 5 个选项（A-E），选项文字简短（4-8 字内）
2. 题目要有趣，能暴露两人的默契度或价值观差异
3. 选项要有迷惑性，不能太明显倾向于某个答案，5 个选项要各有特色
4. 题目要贴近"${pack.name}"主题，贴近中国年轻人的生活语境
5. 不要与已有题目重复或近似

已有题目（严禁重复或换皮）：
${existingList}

请严格返回以下 JSON 格式（不要有任何其他文字）：
{"questions":[{"question":"题干","options":["选项A","选项B","选项C","选项D","选项E"]}]}`;

  const messages = [
    { role: "system", content: "你是一个 JSON 生成器，只返回有效的 JSON，不要任何其他文字。" },
    { role: "user", content: prompt },
  ];

  const parsed = await callGLM(messages, 0.9, `[${pack.id}]`);
  const list = Array.isArray(parsed.questions) ? parsed.questions : [];
  // 规范化：只要 question + 5 个选项
  return list
    .filter((q) => q && typeof q.question === "string" && Array.isArray(q.options))
    .map((q) => ({
      question: q.question.trim(),
      options: q.options.slice(0, 5).map((o) => String(o).trim()),
    }))
    .filter((q) => q.options.length === 5);
}

async function main() {
  console.log("🎯 默契考验题目扩展脚本启动");
  console.log(`   模型: ${MODEL}`);
  console.log(`   目标: 每个题包补充 ${NEW_PER_PACK} 题\n`);

  const { packs, dataPath } = loadExistingPacks();
  console.log(`📖 现有题包: ${packs.length} 个\n`);

  for (const pack of packs) {
    console.log(`[${pack.id}] ${pack.name}（现有 ${pack.questions.length} 题）`);
    try {
      const newQuestions = await generateForPack(pack);
      // 去重：避免与已有题目重复
      const existingSet = new Set(pack.questions.map((q) => q.question));
      const added = [];
      for (const q of newQuestions) {
        if (existingSet.has(q.question)) continue;
        if (added.some((n) => n.question === q.question)) continue;
        added.push(q);
        existingSet.add(q.question);
      }
      pack.questions.push(...added);
      console.log(`   ✓ 生成 ${newQuestions.length} 题，新增 ${added.length} 题（共 ${pack.questions.length} 题）`);
    } catch (err) {
      console.error(`   ✗ 失败: ${err.message}`);
    }
    // 避免 API 限流
    await new Promise((r) => setTimeout(r, 500));
  }

  fs.writeFileSync(dataPath, JSON.stringify(packs, null, 2) + "\n", "utf-8");

  console.log(`\n✅ 题库已更新：${dataPath}`);
  console.log("   各题包题量：");
  packs.forEach((p) => console.log(`     - ${p.id}（${p.name}）: ${p.questions.length} 题`));
}

main().catch((err) => {
  console.error("💥 脚本异常:", err);
  process.exit(1);
});
