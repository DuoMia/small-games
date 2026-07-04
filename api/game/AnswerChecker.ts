/**
 * 答案判定：检查玩家输入是否与正确答案匹配
 * 规则：去除首尾空格、忽略大小写、支持同义词
 */
export function checkAnswer(answer: string, acceptedAnswers: string[]): boolean {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return false;
  return acceptedAnswers.some(
    (acc) => acc.trim().toLowerCase() === normalized
  );
}
