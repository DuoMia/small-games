/**
 * AI 海龟汤题库重做脚本
 * 用智谱 GLM-4-Flash（免费）重新生成 turtle-soup.json
 *
 * 模仿抖音博主"许二木"风格：剧情向、有深度、经典热门、有悬念。
 *
 * 用法：
 *   $env:GLM_API_KEY="你的key"; node scripts/gen-turtle-soup.mjs
 *
 * 或在 scripts/ 目录下创建 .env 文件（已被 .gitignore 忽略）：
 *   GLM_API_KEY=你的key
 *
 * 生成后会覆盖写入 api/data/turtle-soup.json（id 为 ts_001 ~ ts_030）
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
  console.error("   PowerShell: $env:GLM_API_KEY=\"你的key\"; node scripts/gen-turtle-soup.mjs");
  process.exit(1);
}

const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL = "glm-4-flash";
const BATCH_SIZE = 10; // 每批 10 题，避免 JSON 截断
const TOTAL_BATCHES = 3; // 共 3 批，目标 30 题
const MAX_RETRIES = 2; // API 失败重试 2 次

const DIFFICULTIES = ["easy", "medium", "hard"];
const CATEGORIES = ["悬疑", "惊悚", "日常", "奇幻", "温情"];

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

/** 生成一批海龟汤 */
async function generateBatch(batchIdx, existingTitles) {
  const avoidText = existingTitles.length
    ? `\n已有标题（避免重复或近似）：\n${existingTitles.map((t) => `- ${t}`).join("\n")}`
    : "";

  const prompt = `你是海龟汤题库生成器，请模仿抖音知名海龟汤博主"许二木"的风格生成 ${BATCH_SIZE} 道经典海龟汤。

许二木风格特点：
- 剧情向，有人物动机和前因后果，故事性强
- 汤面简短有悬念（50-100 字），看似荒诞但汤底合理
- 汤底完整（100-300 字），揭示真相、人物动机和事件全貌
- 经典热门，难度适中，需要逻辑推理才能想通
- 适合双人合作游玩，避免过于血腥暴力、色情或极端恐怖

题目要求：
1. 每批 10 题，难度尽量分布均匀：约 3 easy、4 medium、3 hard
2. 分类从这些中选：${CATEGORIES.join("、")}
3. title 是简短标题（2-6 字，不要用"海龟汤"本身）
4. surface 是汤面，50-100 字，制造悬念，不要在汤面里剧透真相
5. truth 是汤底，100-300 字，含前因后果和人物动机，把荒诞场景解释通
6. keywords 是 3-5 个关键词，便于 AI 判断玩家提问是否命中关键信息
${avoidText}

请严格返回以下 JSON 格式（不要有任何其他文字）：
{"soups":[{"title":"标题","difficulty":"easy|medium|hard","category":"悬疑|惊悚|日常|奇幻|温情","surface":"汤面","truth":"汤底","keywords":["关键词1","关键词2","关键词3"]}]}`;

  const messages = [
    { role: "system", content: "你是一个 JSON 生成器，只返回有效的 JSON，不要任何其他文字。" },
    { role: "user", content: prompt },
  ];

  const parsed = await callGLM(messages, 0.9, `[batch ${batchIdx + 1}]`);
  const list = Array.isArray(parsed.soups) ? parsed.soups : [];
  return list
    .filter(
      (s) =>
        s &&
        typeof s.title === "string" &&
        typeof s.surface === "string" &&
        typeof s.truth === "string"
    )
    .map((s) => ({
      title: s.title.trim(),
      difficulty: DIFFICULTIES.includes(s.difficulty) ? s.difficulty : "medium",
      category: CATEGORIES.includes(s.category) ? s.category : "悬疑",
      surface: s.surface.trim(),
      truth: s.truth.trim(),
      keywords: Array.isArray(s.keywords)
        ? s.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 5)
        : [],
    }));
}

async function main() {
  console.log("🎯 海龟汤题库重做脚本启动（许二木风格）");
  console.log(`   模型: ${MODEL}`);
  console.log(`   目标: ${TOTAL_BATCHES} 批 × ${BATCH_SIZE} 题 = ${TOTAL_BATCHES * BATCH_SIZE} 题\n`);

  const allSoups = [];
  const seenTitles = new Set(); // 标题去重
  const seenSurface = new Set(); // 汤面去重

  for (let i = 0; i < TOTAL_BATCHES; i++) {
    console.log(`[${i + 1}/${TOTAL_BATCHES}] 生成批次...`);
    try {
      const batch = await generateBatch(i, [...seenTitles]);
      let added = 0;
      for (const s of batch) {
        if (seenTitles.has(s.title)) continue;
        if (seenSurface.has(s.surface)) continue;
        seenTitles.add(s.title);
        seenSurface.add(s.surface);
        allSoups.push(s);
        added++;
      }
      console.log(`   ✓ 本批 ${batch.length} 题，新增 ${added} 题（累计 ${allSoups.length}）`);
    } catch (err) {
      console.error(`   ✗ 失败: ${err.message}`);
    }
    // 避免 API 限流
    await new Promise((r) => setTimeout(r, 500));
  }

  // 编号 id（ts_001 ~ ts_NNN，保持与旧题库一致的字符串格式）
  const finalSoups = allSoups.map((s, idx) => ({
    id: `ts_${String(idx + 1).padStart(3, "0")}`,
    ...s,
  }));

  const dataPath = path.join(__dirname, "..", "api", "data", "turtle-soup.json");
  fs.writeFileSync(dataPath, JSON.stringify(finalSoups, null, 2) + "\n", "utf-8");

  console.log(`\n📊 生成完成：共 ${finalSoups.length} 道海龟汤`);
  console.log(`✅ 题库已重写：${dataPath}`);

  // 难度 + 分类统计
  const diffStats = {};
  const catStats = {};
  finalSoups.forEach((s) => {
    diffStats[s.difficulty] = (diffStats[s.difficulty] || 0) + 1;
    catStats[s.category] = (catStats[s.category] || 0) + 1;
  });
  console.log("   难度分布：", diffStats);
  console.log("   分类分布：", catStats);
}

main().catch((err) => {
  console.error("💥 脚本异常:", err);
  process.exit(1);
});
