/**
 * 题库管理后台 - 独立 Express 服务
 *
 * 安全约束：
 *   - 只监听 127.0.0.1:8788，不 bind 0.0.0.0，Cloudflare Tunnel 不转发
 *   - 仅本机可访问，用于管理 4 个题库的题目
 *
 * 启动：npx tsx api/admin/server.ts  或  npm run admin
 * 环境变量：GLM_API_KEY（AI 扩展用，启动器会从 scripts/.env 注入）
 */
import express, { type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8788;
const DATA_DIR = path.join(__dirname, "..", "data");

// 4 个题库文件路径
const DB_FILES: Record<string, string> = {
  "draw-words": "words.json",
  telepathy: "telepathy-questions.json",
  emoji: "emoji-puzzles.json",
  "turtle-soup": "turtle-soup.json",
};

// === GLM API 配置 ===
const GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const GLM_MODEL = "glm-4-flash";

/** 从环境变量或 scripts/.env 读取 GLM_API_KEY */
function getGlmApiKey(): string | null {
  if (process.env.GLM_API_KEY) return process.env.GLM_API_KEY;
  const envPath = path.join(__dirname, "..", "..", "scripts", ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(/GLM_API_KEY\s*=\s*(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

/** 调用 GLM（带 2 次重试）。返回解析后的 JSON 对象。 */
async function callGLM(messages: any[], temperature: number, retryTag = ""): Promise<any> {
  const apiKey = getGlmApiKey();
  if (!apiKey) throw new Error("未配置 GLM_API_KEY");
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const response = await fetch(GLM_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GLM_MODEL,
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
      lastErr = err as Error;
      if (attempt < 2) {
        console.error(`   ⚠${retryTag} 第 ${attempt + 1} 次失败: ${(err as Error).message}，重试中...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error("GLM 调用失败");
}

// === 读写 JSON 文件工具 ===
function readJson(file: string): any {
  const p = path.join(DATA_DIR, file);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeJson(file: string, data: any): void {
  const p = path.join(DATA_DIR, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// === 各题库的归一化读取（返回统一 items 数组 + 元数据）===

interface PackMeta {
  id: string;
  name: string;
  icon: string;
  color: string;
}

interface NormalizedResult {
  packs?: PackMeta[]; // telepathy 专用：题包元数据
  items: any[]; // 归一化后的题目数组
}

/** 读取题库并归一化为 items 数组 */
function readNormalized(db: string): NormalizedResult {
  const fileName = DB_FILES[db];
  if (!fileName) throw new Error(`未知题库: ${db}`);
  const raw = readJson(fileName);

  if (db === "telepathy") {
    // telepathy: 4 个题包，每个含 questions 数组。展平为 items，每条带 packId
    const packs: PackMeta[] = raw.map((p: any) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      color: p.color,
    }));
    const items: any[] = [];
    for (const pack of raw) {
      for (const q of pack.questions || []) {
        items.push({
          packId: pack.id,
          question: q.question,
          options: q.options || [],
        });
      }
    }
    return { packs, items };
  }
  // 其他题库：items 直接就是数组本身
  return { items: raw };
}

/** 将修改后的 items 写回文件（telepathy 需按 packId 重组）*/
function writeNormalized(db: string, items: any[]): void {
  const fileName = DB_FILES[db];
  if (db === "telepathy") {
    // 读取原始 packs 元数据，按 packId 重组 questions
    const raw = readJson(fileName);
    const packMap = new Map<string, any>();
    for (const pack of raw) {
      packMap.set(pack.id, { ...pack, questions: [] });
    }
    for (const item of items) {
      const pack = packMap.get(item.packId);
      if (pack) {
        pack.questions.push({
          question: item.question,
          options: item.options || [],
        });
      }
    }
    writeJson(fileName, Array.from(packMap.values()));
    return;
  }
  writeJson(fileName, items);
}

// === Express 应用 ===
const app = express();
app.use(express.json({ limit: "50mb" }));

// serve 前端页面（显式声明 charset=utf-8，避免 Windows 浏览器按 GBK 解码导致 emoji 变方框）
app.get("/", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.sendFile(path.join(__dirname, "admin.html"));
});

/** GET /api/:db - 获取题库（归一化后的 items + packs 元数据） */
app.get("/api/:db", (req: Request, res: Response) => {
  const db = req.params.db;
  if (!DB_FILES[db]) {
    res.status(404).json({ success: false, error: `未知题库: ${db}` });
    return;
  }
  try {
    const result = readNormalized(db);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/** POST /api/:db - 新增一条（body: 完整条目对象） */
app.post("/api/:db", (req: Request, res: Response) => {
  const db = req.params.db;
  if (!DB_FILES[db]) {
    res.status(404).json({ success: false, error: `未知题库: ${db}` });
    return;
  }
  try {
    const { items } = readNormalized(db);
    const newItem = normalizeItem(db, req.body);
    items.push(newItem);
    writeNormalized(db, items);
    res.json({ success: true, index: items.length - 1 });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/** PUT /api/:db/:index - 更新某条（body: 完整条目对象） */
app.put("/api/:db/:index", (req: Request, res: Response) => {
  const db = req.params.db;
  if (!DB_FILES[db]) {
    res.status(404).json({ success: false, error: `未知题库: ${db}` });
    return;
  }
  const idx = parseInt(req.params.index, 10);
  if (Number.isNaN(idx)) {
    res.status(400).json({ success: false, error: "index 必须是数字" });
    return;
  }
  try {
    const { items } = readNormalized(db);
    if (idx < 0 || idx >= items.length) {
      res.status(400).json({ success: false, error: `index 越界: ${idx}（当前 ${items.length} 条）` });
      return;
    }
    const updated = normalizeItem(db, req.body);
    items[idx] = updated;
    writeNormalized(db, items);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/** DELETE /api/:db/:index - 删除某条 */
app.delete("/api/:db/:index", (req: Request, res: Response) => {
  const db = req.params.db;
  if (!DB_FILES[db]) {
    res.status(404).json({ success: false, error: `未知题库: ${db}` });
    return;
  }
  const idx = parseInt(req.params.index, 10);
  if (Number.isNaN(idx)) {
    res.status(400).json({ success: false, error: "index 必须是数字" });
    return;
  }
  try {
    const { items } = readNormalized(db);
    if (idx < 0 || idx >= items.length) {
      res.status(400).json({ success: false, error: `index 越界: ${idx}（当前 ${items.length} 条）` });
      return;
    }
    items.splice(idx, 1);
    writeNormalized(db, items);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/** 规范化条目：根据题库类型清理字段 */
function normalizeItem(db: string, raw: any): any {
  if (db === "draw-words") {
    return {
      word: String(raw.word || "").trim(),
      synonyms: Array.isArray(raw.synonyms)
        ? raw.synonyms.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 5)
        : [],
      category: String(raw.category || "物品").trim(),
    };
  }
  if (db === "telepathy") {
    return {
      packId: String(raw.packId || "life").trim(),
      question: String(raw.question || "").trim(),
      options: Array.isArray(raw.options)
        ? raw.options.map((o: any) => String(o).trim()).filter(Boolean).slice(0, 5)
        : [],
    };
  }
  if (db === "emoji") {
    return {
      id: Number(raw.id),
      category: String(raw.category || "").trim(),
      emoji: String(raw.emoji || "").trim(),
      answer: String(raw.answer || "").trim(),
      alternatives: Array.isArray(raw.alternatives)
        ? raw.alternatives.map((a: any) => String(a).trim()).filter(Boolean).slice(0, 3)
        : [],
    };
  }
  if (db === "turtle-soup") {
    return {
      id: String(raw.id || "").trim(),
      title: String(raw.title || "").trim(),
      difficulty: ["easy", "medium", "hard"].includes(raw.difficulty) ? raw.difficulty : "medium",
      category: String(raw.category || "悬疑").trim(),
      surface: String(raw.surface || "").trim(),
      truth: String(raw.truth || "").trim(),
      keywords: Array.isArray(raw.keywords)
        ? raw.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 5)
        : [],
    };
  }
  return raw;
}

/** 重新分配 id（emoji 用 max+1，turtle-soup 用 ts_XXX）*/
function reassignIds(db: string, items: any[]): void {
  if (db === "emoji") {
    let maxId = 0;
    for (const it of items) {
      if (typeof it.id === "number" && it.id > maxId) maxId = it.id;
    }
    // 先把无 id 或冲突的补上
    for (const it of items) {
      if (!Number.isFinite(it.id) || it.id <= 0) {
        it.id = ++maxId;
      }
    }
    return;
  }
  if (db === "turtle-soup") {
    // 重新编号 ts_001 ~ ts_NNN，保持格式一致
    items.forEach((it, idx) => {
      it.id = `ts_${String(idx + 1).padStart(3, "0")}`;
    });
    return;
  }
  // words / telepathy 无 id
}

// === AI 扩展接口 ===

/** emoji 字段是否包含禁止字符（汉字/英文字母/数字） */
function hasForbiddenChars(emoji: string): boolean {
  if (typeof emoji !== "string") return true;
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(emoji);
}

/** POST /api/:db/ai-expand - AI 扩展题库
 * body: { count: number, options?: { category?: string, packId?: string, difficulty?: string } }
 */
app.post("/api/:db/ai-expand", async (req: Request, res: Response) => {
  const db = req.params.db;
  if (!DB_FILES[db]) {
    res.status(404).json({ success: false, error: `未知题库: ${db}` });
    return;
  }
  if (!getGlmApiKey()) {
    res.status(400).json({
      success: false,
      error: "未配置 GLM_API_KEY，请在 scripts/.env 中设置（格式：GLM_API_KEY=你的key）",
    });
    return;
  }
  const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 10, 1), 50);
  const options = req.body?.options || {};

  try {
    const { items } = readNormalized(db);
    let newItems: any[] = [];

    if (db === "draw-words") {
      newItems = await aiExpandWords(count, options.category, items);
    } else if (db === "telepathy") {
      newItems = await aiExpandTelepathy(count, options.packId, items);
    } else if (db === "emoji") {
      newItems = await aiExpandEmoji(count, items);
    } else if (db === "turtle-soup") {
      newItems = await aiExpandTurtleSoup(count, options.difficulty, items);
    }

    // 合并去重
    const before = items.length;
    if (db === "draw-words") {
      const seen = new Set(items.map((i: any) => i.word));
      for (const n of newItems) {
        if (!seen.has(n.word)) {
          items.push(n);
          seen.add(n.word);
        }
      }
    } else if (db === "telepathy") {
      const seen = new Set(items.map((i: any) => i.question));
      for (const n of newItems) {
        if (!seen.has(n.question)) {
          items.push(n);
          seen.add(n.question);
        }
      }
    } else if (db === "emoji") {
      const seenEmoji = new Set(items.map((i: any) => i.emoji));
      const seenAnswer = new Set(items.map((i: any) => i.answer));
      for (const n of newItems) {
        if (hasForbiddenChars(n.emoji)) continue;
        if (seenEmoji.has(n.emoji) || seenAnswer.has(n.answer)) continue;
        items.push(n);
        seenEmoji.add(n.emoji);
        seenAnswer.add(n.answer);
      }
    } else if (db === "turtle-soup") {
      const seenTitle = new Set(items.map((i: any) => i.title));
      const seenSurface = new Set(items.map((i: any) => i.surface));
      for (const n of newItems) {
        if (seenTitle.has(n.title) || seenSurface.has(n.surface)) continue;
        items.push(n);
        seenTitle.add(n.title);
        seenSurface.add(n.surface);
      }
    }

    reassignIds(db, items);
    writeNormalized(db, items);
    const added = items.length - before;
    res.json({ success: true, added, total: items.length });
  } catch (err) {
    console.error("[AI 扩展失败]", err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// === 各题库 AI 扩展 prompt ===

const WORD_CATEGORIES = ["食物", "动物", "物品", "交通", "建筑", "人物", "自然"];
const TELEPATHY_PACKS: Record<string, { name: string }> = {
  life: { name: "生活日常" },
  love: { name: "恋爱心动" },
  funny: { name: "搞笑脑洞" },
  work: { name: "职场社畜" },
};
const EMOJI_CATEGORIES = ["成语", "影视"];
const SOUP_CATEGORIES = ["悬疑", "惊悚", "日常", "奇幻", "温情"];
const SOUP_DIFFICULTIES = ["easy", "medium", "hard"];

/** 画图猜词 AI 扩展 */
async function aiExpandWords(count: number, category: string | undefined, existing: any[]): Promise<any[]> {
  const cat = category && WORD_CATEGORIES.includes(category) ? category : WORD_CATEGORIES[Math.floor(Math.random() * WORD_CATEGORIES.length)];
  const avoid = existing.slice(-20).map((w) => w.word).join("、");
  const prompt = `你是画画猜词游戏的词语生成器。请生成适合画画的"${cat}"类词语。

要求：
1. 生成 ${count} 个不同的词语
2. 每个词语必须是一个名词，适合用简笔画表达
3. 词语要常见，但不能太简单（避免"水"、"石头"这种过于简单的）
4. 每个词语附带 1-3 个同义词或近义词
${avoid ? `5. 避免与这些已有词重复或近似：${avoid}\n` : ""}请严格返回以下 JSON 格式（不要有任何其他文字）：
{"words":[{"word":"词语","synonyms":["同义词1","同义词2"],"category":"${cat}"}]}`;

  const parsed = await callGLM(
    [
      { role: "system", content: "你是一个JSON生成器，只返回有效的JSON，不要任何其他文字。" },
      { role: "user", content: prompt },
    ],
    0.9,
    "[words]"
  );
  const list = Array.isArray(parsed.words) ? parsed.words : [];
  return list
    .filter((w: any) => w && typeof w.word === "string")
    .map((w: any) => ({
      word: String(w.word).trim(),
      synonyms: Array.isArray(w.synonyms) ? w.synonyms.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 3) : [],
      category: cat,
    }));
}

/** 默契考验 AI 扩展（需指定题包 packId） */
async function aiExpandTelepathy(count: number, packId: string | undefined, existing: any[]): Promise<any[]> {
  const pid = packId && TELEPATHY_PACKS[packId] ? packId : "life";
  const packName = TELEPATHY_PACKS[pid].name;
  const avoid = existing.filter((i) => i.packId === pid).slice(-15).map((i) => `- ${i.question}`).join("\n");
  const prompt = `你是默契考验游戏的题目生成器。请为"${packName}"题包生成 ${count} 道新题目。

要求：
1. 每题必须有 5 个选项（A-E），选项文字简短（4-8 字内）
2. 题目要有趣，能暴露两人的默契度或价值观差异
3. 选项要有迷惑性，不能太明显倾向于某个答案，5 个选项要各有特色
4. 题目要贴近"${packName}"主题，贴近中国年轻人的生活语境
5. 不要与已有题目重复或近似
${avoid ? `已有题目（严禁重复或换皮）：\n${avoid}\n` : ""}请严格返回以下 JSON 格式（不要有任何其他文字）：
{"questions":[{"question":"题干","options":["选项A","选项B","选项C","选项D","选项E"]}]}`;

  const parsed = await callGLM(
    [
      { role: "system", content: "你是一个 JSON 生成器，只返回有效的 JSON，不要任何其他文字。" },
      { role: "user", content: prompt },
    ],
    0.9,
    `[telepathy-${pid}]`
  );
  const list = Array.isArray(parsed.questions) ? parsed.questions : [];
  return list
    .filter((q: any) => q && typeof q.question === "string" && Array.isArray(q.options))
    .map((q: any) => ({
      packId: pid,
      question: String(q.question).trim(),
      options: q.options.slice(0, 5).map((o: any) => String(o).trim()),
    }))
    .filter((q: any) => q.options.length === 5);
}

/** 表情包猜词 AI 扩展 */
async function aiExpandEmoji(count: number, existing: any[]): Promise<any[]> {
  const avoid = existing.slice(-15).map((i) => `${i.emoji}=${i.answer}`).join("、");
  const prompt = `你是表情包猜词游戏的题目生成器。请生成 ${count} 道题目。

【题目范围 —— 只允许两类，违反即作废】
1. 成语：耳熟能详的中文成语（如画蛇添足、守株待兔、亡羊补牢、井底之蛙、对牛弹琴等）
2. 影视：大众熟知的电影/电视剧/动画（如西游记、泰坦尼克号、流浪地球、哈利波特、冰雪奇缘、狮子王等）
绝不能生成普通名词（如"披萨""熊猫""生日"）或自造词（如"披萨狂欢""点赞狂魔"）。

【最重要要求 —— emoji 字段违反即作废】
emoji 字段只能包含 emoji 字符和连接符（+、-、空格），绝对不能包含任何汉字、英文字母、数字、标点符号。
例如 ❌ 错误：🐲腾🐯跃、❄️👸Snowman、🐴功夫（混入了文字）
例如 ✅ 正确：🐍✏️🦶（画蛇添足）、🚢💔🧊（泰坦尼克号）、🦁👑🌅（狮子王）

其他要求：
1. emoji 组合要能让人联想到答案，但需要一点思考，不能一看就懂
2. 答案必须是被大众熟知的成语或影视作品名（2-8字）
3. alternatives 给 1-3 个同义/别名（如"西游记"可含"大话西游"；可为空数组）
4. 题目要可猜，不要过于冷门
${avoid ? `5. 避免与这些已有题重复：${avoid}\n` : ""}请严格返回以下 JSON 格式（不要有任何其他文字）：
{"puzzles":[{"category":"成语或影视","emoji":"纯emoji","answer":"答案","alternatives":["alt1","alt2"]}]}`;

  const parsed = await callGLM(
    [
      { role: "system", content: "你是一个 JSON 生成器，只返回有效的 JSON，不要任何其他文字。" },
      { role: "user", content: prompt },
    ],
    0.9,
    "[emoji]"
  );
  const list = Array.isArray(parsed.puzzles) ? parsed.puzzles : [];
  return list
    .filter((p: any) => p && typeof p.emoji === "string" && typeof p.answer === "string")
    .map((p: any) => ({
      id: 0, // 重新分配
      category: String(p.category || "").trim(),
      emoji: String(p.emoji).trim(),
      answer: String(p.answer).trim(),
      alternatives: Array.isArray(p.alternatives)
        ? p.alternatives.map((a: any) => String(a).trim()).filter(Boolean).slice(0, 3)
        : [],
    }));
}

/** 海龟汤 AI 扩展（许二木风格） */
async function aiExpandTurtleSoup(count: number, difficulty: string | undefined, existing: any[]): Promise<any[]> {
  const avoidTitles = existing.slice(-20).map((s) => `- ${s.title}`).join("\n");
  const diffHint = difficulty && SOUP_DIFFICULTIES.includes(difficulty) ? `，难度偏向 ${difficulty}` : "";
  const prompt = `你是海龟汤题库生成器，请模仿抖音知名海龟汤博主"许二木"的风格生成 ${count} 道经典海龟汤。

许二木风格特点：
- 剧情向，有人物动机和前因后果，故事性强
- 汤面简短有悬念（50-100 字），看似荒诞但汤底合理
- 汤底完整（100-300 字），揭示真相、人物动机和事件全貌
- 经典热门，难度适中，需要逻辑推理才能想通
- 适合双人合作游玩，避免过于血腥暴力、色情或极端恐怖

题目要求：
1. 生成 ${count} 题${diffHint}，难度尽量分布均匀
2. 分类从这些中选：${SOUP_CATEGORIES.join("、")}
3. title 是简短标题（2-6 字，不要用"海龟汤"本身）
4. surface 是汤面，50-100 字，制造悬念，不要在汤面里剧透真相
5. truth 是汤底，100-300 字，含前因后果和人物动机，把荒诞场景解释通
6. keywords 是 3-5 个关键词，便于 AI 判断玩家提问是否命中关键信息
${avoidTitles ? `已有标题（避免重复或近似）：\n${avoidTitles}\n` : ""}请严格返回以下 JSON 格式（不要有任何其他文字）：
{"soups":[{"title":"标题","difficulty":"easy|medium|hard","category":"悬疑|惊悚|日常|奇幻|温情","surface":"汤面","truth":"汤底","keywords":["关键词1","关键词2","关键词3"]}]}`;

  const parsed = await callGLM(
    [
      { role: "system", content: "你是一个 JSON 生成器，只返回有效的 JSON，不要任何其他文字。" },
      { role: "user", content: prompt },
    ],
    0.9,
    "[turtle-soup]"
  );
  const list = Array.isArray(parsed.soups) ? parsed.soups : [];
  return list
    .filter((s: any) => s && typeof s.title === "string" && typeof s.surface === "string" && typeof s.truth === "string")
    .map((s: any) => ({
      id: "", // 重新分配
      title: String(s.title).trim(),
      difficulty: SOUP_DIFFICULTIES.includes(s.difficulty) ? s.difficulty : "medium",
      category: SOUP_CATEGORIES.includes(s.category) ? s.category : "悬疑",
      surface: String(s.surface).trim(),
      truth: String(s.truth).trim(),
      keywords: Array.isArray(s.keywords)
        ? s.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 5)
        : [],
    }));
}

// 启动服务，只监听 127.0.0.1（不暴露公网，cloudflare tunnel 不转发）
app.listen(PORT, "127.0.0.1", () => {
  console.log(`🛠 题库管理后台已启动: http://127.0.0.1:${PORT}`);
  console.log(`   仅本机可访问，不暴露公网`);
  if (!getGlmApiKey()) {
    console.log(`   ⚠ 未配置 GLM_API_KEY，AI 扩展功能不可用（请在 scripts/.env 设置）`);
  } else {
    console.log(`   ✓ 已加载 GLM_API_KEY，AI 扩展可用`);
  }
});

process.on("SIGINT", () => {
  console.log("\n管理后台已停止");
  process.exit(0);
});
