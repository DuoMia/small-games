// 双人解密 AI 出题 + 判断：封装 GLM-4-Flash API 调用
// API key 从环境变量 GLM_API_KEY 读取

const GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const GLM_MODEL = "glm-4-flash";

// 谜题难度
export type MysteryDifficulty = "simple" | "medium" | "hard";

// 谜题结构
export interface MysteryCase {
  id: string;
  title: string;
  story: string;
  cluesA: string[];
  cluesB: string[];
  answer: string;
  keywords: string[];
  difficulty: MysteryDifficulty;
  category: string; // 逻辑推理 / 密码解谜 / 找线索
}

const VALID_DIFFICULTIES: MysteryDifficulty[] = ["simple", "medium", "hard"];
const MYSTERY_CATEGORIES = ["逻辑推理", "密码解谜", "找线索"];

/**
 * 让 AI 生成一道双人解密谜题
 * difficulty 传 "simple" | "medium" | "hard"，AI 据此调整难度
 * 失败时返回 null，由调用方走预设题库兜底
 */
export async function generateMysteryCase(
  difficulty: MysteryDifficulty
): Promise<MysteryCase | null> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    console.warn("[mystery.ts] GLM_API_KEY 未配置，generateMysteryCase 返回 null");
    return null;
  }

  const prompt = `你是双人解密游戏的出题人。请生成一道难度为"${difficulty}"的合作推理谜题。

要求：
1. 谜题类型只能是：逻辑推理、密码解谜、找线索 三选一（不要经典谜语）
2. story 是故事背景，50-150 字，制造悬念但不剧透答案
3. cluesA 是给玩家A的线索数组（2-3条），cluesB 是给玩家B的线索数组（2-3条）
4. 两人线索必须互补，单独一方无法解出，需要通过聊天交流拼凑信息才能得到答案
5. answer 是完整答案，30-100 字，解释清楚推理过程
6. keywords 是 3-5 个关键词，便于判断玩家回答是否命中关键信息
7. title 是简短标题（2-6 字）
8. category 只能是"逻辑推理"、"密码解谜"或"找线索"
9. 难度 ${difficulty}：simple 较直白，medium 需要一步推理，hard 需要多步推理

请严格返回以下 JSON 格式（不要有任何其他文字）：
{"title":"标题","story":"故事","cluesA":["线索1","线索2"],"cluesB":["线索1","线索2"],"answer":"答案","keywords":["关键词1","关键词2"],"difficulty":"${difficulty}","category":"逻辑推理"}`;

  try {
    const resp = await fetch(GLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GLM_MODEL,
        temperature: 0.9,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是一个 JSON 生成器，只返回有效的 JSON，不要任何其他文字。" },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      console.error(`[mystery.ts] GLM API HTTP ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const data: any = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);

    // 字段校验
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.story !== "string" ||
      !Array.isArray(parsed.cluesA) ||
      !Array.isArray(parsed.cluesB) ||
      typeof parsed.answer !== "string"
    ) {
      console.warn("[mystery.ts] AI 返回字段不全，放弃");
      return null;
    }

    const diff: MysteryDifficulty = VALID_DIFFICULTIES.includes(parsed.difficulty)
      ? parsed.difficulty
      : difficulty;
    const category = MYSTERY_CATEGORIES.includes(parsed.category)
      ? parsed.category
      : "逻辑推理";

    return {
      id: `ai_${Date.now()}`,
      title: String(parsed.title).trim(),
      story: String(parsed.story).trim(),
      cluesA: parsed.cluesA.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 4),
      cluesB: parsed.cluesB.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 4),
      answer: String(parsed.answer).trim(),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 5)
        : [],
      difficulty: diff,
      category,
    };
  } catch (err) {
    console.error("[mystery.ts] generateMysteryCase 异常：", err);
    return null;
  }
}

/**
 * 判断玩家提交的答案是否正确（语义匹配，非精确匹配）
 * API 失败时用关键词匹配兜底
 */
export async function mysteryJudge(
  userAnswer: string,
  correctAnswer: string,
  keywords: string[]
): Promise<{ correct: boolean; close: boolean; feedback: string }> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    // 兜底：关键词匹配
    return keywordFallback(userAnswer, correctAnswer, keywords);
  }

  const prompt = `你是双人解密游戏的裁判。正确答案：${correctAnswer}。关键要素：${keywords.join("、")}。玩家提交的答案：${userAnswer}。判断玩家答案是否正确。如果语义上完全正确或高度接近返回correct=true。如果部分接近（命中部分关键词但推理不完整）返回close=true。给一句简短反馈（不超过20字，不要透露正确答案）。返回JSON格式：{correct, close, feedback}`;

  try {
    const resp = await fetch(GLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GLM_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      console.error(`[mystery.ts] GLM API HTTP ${resp.status}: ${await resp.text()}`);
      return keywordFallback(userAnswer, correctAnswer, keywords);
    }

    const data: any = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    const correct = Boolean(parsed.correct);
    const close = Boolean(parsed.close);
    const feedback = typeof parsed.feedback === "string" ? parsed.feedback.slice(0, 20) : "判断完成";
    return { correct, close: close || correct, feedback };
  } catch (err) {
    console.error("[mystery.ts] mysteryJudge 异常：", err);
    return keywordFallback(userAnswer, correctAnswer, keywords);
  }
}

/**
 * 关键词匹配兜底：玩家答案命中所有关键词算 correct，命中半数以上算 close
 */
function keywordFallback(
  userAnswer: string,
  correctAnswer: string,
  keywords: string[]
): { correct: boolean; close: boolean; feedback: string } {
  const ans = (userAnswer || "").toLowerCase();
  const truth = (correctAnswer || "").toLowerCase();
  // 答案文本完全包含算正确
  if (truth && ans.includes(truth)) {
    return { correct: true, close: true, feedback: "完全正确！" };
  }
  // 命中关键词统计
  const hits = keywords.filter((k) => k && ans.includes(k.toLowerCase()));
  if (keywords.length > 0 && hits.length === keywords.length) {
    return { correct: true, close: true, feedback: "完全正确！" };
  }
  if (hits.length >= Math.ceil(keywords.length / 2)) {
    return { correct: false, close: true, feedback: "接近了，再想想" };
  }
  return { correct: false, close: false, feedback: "不对，继续推理" };
}
