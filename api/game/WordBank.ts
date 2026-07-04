import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import type { WordEntry } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载词库
const wordsPath = path.resolve(__dirname, "../data/words.json");
const wordBank: WordEntry[] = JSON.parse(readFileSync(wordsPath, "utf-8"));

/**
 * 从词库中随机抽取指定数量的不重复词语
 */
export function pickRandomWords(count: number, excludeWords: string[] = []): WordEntry[] {
  const available = wordBank.filter((w) => !excludeWords.includes(w.word));
  const pool = available.length >= count ? available : wordBank;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * 生成答题题目：从 30 个词语中随机选 10 个序号
 */
export function generateQuestions(words: WordEntry[], count: number): {
  wordIndex: number;
  correctAnswer: string;
  acceptedAnswers: string[];
}[] {
  const indices = Array.from({ length: words.length }, (_, i) => i);
  const shuffled = indices.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);
  return selected.map((idx) => ({
    wordIndex: idx,
    correctAnswer: words[idx].word,
    acceptedAnswers: [words[idx].word, ...words[idx].synonyms],
  }));
}

export { wordBank };
