import type { Stroke } from "@/components/DrawingCanvas";

const CANVAS_W = 600;
const CANVAS_H = 450;

/** 计算笔画路径总长度 */
function strokeLength(stroke: Stroke): number {
  let len = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const dx = stroke.points[i].x - stroke.points[i - 1].x;
    const dy = stroke.points[i].y - stroke.points[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/** 计算所有非橡皮笔画的总边界框 */
function strokesBoundingBox(strokes: Stroke[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of strokes) {
    if (s.isEraser) continue;
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return { width: 0, height: 0 };
  return { width: maxX - minX, height: maxY - minY };
}

/**
 * 启发式检测笔画是否疑似文字（中文/数字）
 *
 * 文字特征：
 * - 由多条短直线段组成（汉字笔画、数字笔划）
 * - 每条笔画点数少、路径短
 * - 集中在一个较小区域内
 *
 * 注意：这是启发式检测，可能误判（画房子、表格等）或漏报（大字、连笔）。
 * 仅作为软性提醒，不强制阻止提交。
 *
 * @returns 是否疑似包含文字
 */
export function hasTextSuspicion(strokes: Stroke[]): boolean {
  const nonEraser = strokes.filter((s) => !s.isEraser);
  if (nonEraser.length < 4) return false;

  // 统计"短而少点"的笔画（文字笔画特征）
  const suspicious = nonEraser.filter((s) => {
    const len = strokeLength(s);
    // 路径长度 < 画布宽度的 20%，且点数 <= 20
    return len < CANVAS_W * 0.2 && s.points.length <= 20;
  });

  // 短笔画数 >= 4，疑似文字
  if (suspicious.length < 4) return false;

  // 额外检查：所有笔画集中在一个较小区域（文字通常占画布小部分）
  const box = strokesBoundingBox(nonEraser);
  const boxArea = box.width * box.height;
  const canvasArea = CANVAS_W * CANVAS_H;
  return boxArea < canvasArea * 0.6;
}
