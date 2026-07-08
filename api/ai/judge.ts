// AI 裁判：封装 GLM API 调用（合作画画评分）
// API key 从环境变量 GLM_API_KEY 读取

const GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
// 视觉模型（用于合作画画评分，看图打分）
const GLM_VISION_MODEL = "glm-4v-flash";

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
