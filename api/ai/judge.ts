// 海龟汤 AI 裁判：封装 GLM-4-Flash API 调用
// API key 从环境变量 GLM_API_KEY 读取

const GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const GLM_MODEL = "glm-4-flash";
// 视觉模型（用于合作画画评分，看图打分）
const GLM_VISION_MODEL = "glm-4v-flash";

/**
 * 判断玩家提问是否与汤底相关
 * 返回 "是" / "否" / "无关"
 * API 失败时兜底返回 "无关"
 */
export async function judgeQuestion(
  question: string,
  truth: string,
  keywords: string[]
): Promise<"是" | "否" | "无关"> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    console.warn("[judge.ts] GLM_API_KEY 未配置，judgeQuestion 返回兜底值");
    return "无关";
  }

  const prompt = `你是海龟汤主持人。汤底真相：${truth}。关键要素：${keywords.join("、")}。玩家提问：${question}。规则：只能回答"是"、"否"、"无关"三选一。如果问题与汤底相关且符合事实答"是"，相关但不符合答"否"，完全无关答"无关"。判断要宽松，玩家表述不精确但意思接近时也算"是"。只返回一个字：是/否/无关`;

  try {
    const resp = await fetch(GLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GLM_MODEL,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      console.error(`[judge.ts] GLM API HTTP ${resp.status}: ${await resp.text()}`);
      return "无关";
    }

    const data: any = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content || "";
    const trimmed = content.trim();

    // 解析返回内容，取第一个字判断
    if (trimmed.startsWith("是")) return "是";
    if (trimmed.startsWith("否")) return "否";
    if (trimmed.startsWith("无关")) return "无关";

    // 兜底
    console.warn(`[judge.ts] GLM 返回无法解析：${trimmed}`);
    return "无关";
  } catch (err) {
    console.error("[judge.ts] judgeQuestion 异常：", err);
    return "无关";
  }
}

/**
 * 判断玩家猜测是否接近真相
 * 返回 correct / close / feedback
 * API 失败时兜底返回 { correct:false, close:false, feedback:"判断失败" }
 */
export async function judgeGuess(
  guess: string,
  truth: string,
  keywords: string[]
): Promise<{ correct: boolean; close: boolean; feedback: string }> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    console.warn("[judge.ts] GLM_API_KEY 未配置，judgeGuess 返回兜底值");
    return { correct: false, close: false, feedback: "AI服务未配置" };
  }

  const prompt = `你是海龟汤裁判。汤底真相：${truth}。关键要素：${keywords.join("、")}。玩家猜测：${guess}。判断玩家是否猜中了真相。如果完全正确或高度接近返回correct=true。如果部分接近返回close=true。给一句简短反馈（不超过20字，不要透露真相）。返回JSON格式：{correct, close, feedback}`;

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
      console.error(`[judge.ts] GLM API HTTP ${resp.status}: ${await resp.text()}`);
      return { correct: false, close: false, feedback: "判断失败" };
    }

    const data: any = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content || "";

    // 尝试解析 JSON
    const parsed = JSON.parse(content);
    const correct = Boolean(parsed.correct);
    const close = Boolean(parsed.close);
    const feedback = typeof parsed.feedback === "string" ? parsed.feedback.slice(0, 20) : "判断完成";

    // correct 时 close 也算 true（语义上完全正确也算接近）
    return { correct, close: close || correct, feedback };
  } catch (err) {
    console.error("[judge.ts] judgeGuess 异常：", err);
    return { correct: false, close: false, feedback: "判断失败" };
  }
}

/**
 * 合作画画 AI 评分：用 glm-4v-flash 视觉模型看图打分
 * imageDataURL: data:image/jpeg;base64,... 格式
 * prompt: 当前命题
 * 返回 { score: 0-10, comment: 一句评价 }
 * API 未配置或失败时兜底返回 { score: 5, comment: "AI评分服务暂不可用" }
 */
export async function judgeDrawing(
  imageDataURL: string,
  prompt: string
): Promise<{ score: number; comment: string }> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    console.warn("[judge.ts] GLM_API_KEY 未配置，judgeDrawing 返回兜底值");
    return { score: 5, comment: "AI评分未配置" };
  }
  if (!imageDataURL) {
    return { score: 5, comment: "画作为空，无法评分" };
  }

  // 视觉模型 messages 格式：content 用数组，包含 text 和 image_url
  const userContent = [
    {
      type: "text",
      text: `这是两人合作画的命题"${prompt}"。请根据画作与命题的契合度、完整度、美观度综合打分，分数0-10（整数）。再给一句简短评价（不超过30字，鼓励为主）。返回JSON格式：{"score": 数字, "comment": "评价"}`,
    },
    {
      type: "image_url",
      image_url: { url: imageDataURL },
    },
  ];

  try {
    const resp = await fetch(GLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GLM_VISION_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: userContent as any }],
      }),
    });

    if (!resp.ok) {
      console.error(`[judge.ts] GLM Vision API HTTP ${resp.status}: ${await resp.text()}`);
      return { score: 5, comment: "AI评分服务暂不可用" };
    }

    const data: any = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content || "";

    // 尝试解析 JSON
    const parsed = JSON.parse(content);
    const rawScore = Number(parsed.score);
    // 分数限制 0-10
    const score = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(10, Math.round(rawScore)))
      : 5;
    const comment =
      typeof parsed.comment === "string"
        ? parsed.comment.slice(0, 30)
        : "评分完成";

    return { score, comment };
  } catch (err) {
    console.error("[judge.ts] judgeDrawing 异常：", err);
    return { score: 5, comment: "AI评分服务暂不可用" };
  }
}
