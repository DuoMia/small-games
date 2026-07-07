/**
 * 表情包猜词题库重做脚本 v2 —— 「元素组合联想」逻辑
 *
 * 旧题库问题：emoji 直接画出答案（如 🦁👑=狮子王），或混入文字/数字，或完全无关。
 * 本脚本改用「元素组合联想」逻辑：用多个 emoji 描述作品的关键角色/元素/动作，
 * 玩家通过组合元素联想答案。例如 🐒🐷🐴👨‍🦲 → 西游记（师徒四人）。
 *
 * 用法：
 *   $env:GLM_API_KEY="你的key"; node scripts/gen-emoji-puzzles-v2.mjs
 *   或在 scripts/.env 中配置 GLM_API_KEY（已存在）
 *
 * 生成后覆盖写入 api/data/emoji-puzzles.json（id 从 1 重新编号）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === 读取 GLM_API_KEY ===
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
  console.error("   PowerShell: $env:GLM_API_KEY=\"你的key\"; node scripts/gen-emoji-puzzles-v2.mjs");
  process.exit(1);
}

const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL = "glm-4-flash";
const MAX_RETRIES = 2;

// === 手写种子题库（保证质量底线；AI 仅作补充扩展） ===
// 逻辑：用多个 emoji 描述作品关键元素/角色/动作，通过组合让人联想答案
const SEED_PUZZLES = [
  // ===== 成语类（描绘故事场景/动作，非直接拼字面）=====
  { category: "成语", emoji: "🌳🐰👴⏳", answer: "守株待兔", alternatives: [] },
  { category: "成语", emoji: "🐍✏️🦶", answer: "画蛇添足", alternatives: [] },
  { category: "成语", emoji: "🐑🔨🏠", answer: "亡羊补牢", alternatives: [] },
  { category: "成语", emoji: "🕳️🐸", answer: "井底之蛙", alternatives: [] },
  { category: "成语", emoji: "🐂🎸🎵", answer: "对牛弹琴", alternatives: [] },
  { category: "成语", emoji: "🦊🐯😱", answer: "狐假虎威", alternatives: [] },
  { category: "成语", emoji: "🍷🏹🐍", answer: "杯弓蛇影", alternatives: [] },
  { category: "成语", emoji: "🐉✏️👁️", answer: "画龙点睛", alternatives: [] },
  { category: "成语", emoji: "👴🐉", answer: "叶公好龙", alternatives: [] },
  { category: "成语", emoji: "🤭🔔🏃", answer: "掩耳盗铃", alternatives: [] },
  { category: "成语", emoji: "🐢🐰🏁", answer: "龟兔赛跑", alternatives: [] },
  { category: "成语", emoji: "🐓🗡️🌅", answer: "闻鸡起舞", alternatives: [] },
  { category: "成语", emoji: "🐔🔪🐒", answer: "杀鸡儆猴", alternatives: ["杀鸡吓猴"] },
  { category: "成语", emoji: "🐱📷🐯", answer: "照猫画虎", alternatives: [] },
  { category: "成语", emoji: "🦌👉🐎", answer: "指鹿为马", alternatives: [] },
  { category: "成语", emoji: "⛵🔪💧", answer: "刻舟求剑", alternatives: [] },
  { category: "成语", emoji: "🐦🏹😨", answer: "惊弓之鸟", alternatives: [] },
  { category: "成语", emoji: "🌰🔥🤲", answer: "火中取栗", alternatives: [] },
  { category: "成语", emoji: "🐔🔪🥚", answer: "杀鸡取卵", alternatives: [] },
  { category: "成语", emoji: "🍲🔥🪵", answer: "釜底抽薪", alternatives: [] },
  { category: "成语", emoji: "🌊🤲🐟", answer: "浑水摸鱼", alternatives: [] },
  { category: "成语", emoji: "👴⛰️⛏️", answer: "愚公移山", alternatives: [] },
  { category: "成语", emoji: "🛡️⚔️🤜", answer: "自相矛盾", alternatives: [] },
  { category: "成语", emoji: "🌱👆📏", answer: "拔苗助长", alternatives: ["揠苗助长"] },
  { category: "成语", emoji: "🦩🐔🐔", answer: "鹤立鸡群", alternatives: [] },
  { category: "成语", emoji: "🤲🐑🚶", answer: "顺手牵羊", alternatives: [] },
  { category: "成语", emoji: "🐯⛰️🚶", answer: "调虎离山", alternatives: [] },
  { category: "成语", emoji: "🍐👀🤤", answer: "望梅止渴", alternatives: [] },
  { category: "成语", emoji: "🌳⚔️😱", answer: "草木皆兵", alternatives: [] },
  { category: "成语", emoji: "⚒️🍲🚢⚓", answer: "破釜沉舟", alternatives: [] },
  { category: "成语", emoji: "📄⚔️🗣️", answer: "纸上谈兵", alternatives: [] },
  { category: "成语", emoji: "🎺🎺🔇", answer: "滥竽充数", alternatives: [] },
  { category: "成语", emoji: "😟🌍☁️", answer: "杞人忧天", alternatives: [] },
  { category: "成语", emoji: "🤲🪵🔥", answer: "抱薪救火", alternatives: [] },
  { category: "成语", emoji: "🌊🚢🤫", answer: "瞒天过海", alternatives: [] },
  { category: "成语", emoji: "🥤🐍💊", answer: "饮鸩止渴", alternatives: [] },
  { category: "成语", emoji: "🔥🏃💰", answer: "趁火打劫", alternatives: [] },
  { category: "成语", emoji: "🫓✏️🤤", answer: "画饼充饥", alternatives: [] },
  { category: "成语", emoji: "🏭💰🔙💎", answer: "买椟还珠", alternatives: [] },
  { category: "成语", emoji: "🧗🐟", answer: "缘木求鱼", alternatives: [] },
  { category: "成语", emoji: "👄🍯🗡️", answer: "口蜜腹剑", alternatives: [] },
  { category: "成语", emoji: "😊🔪", answer: "笑里藏刀", alternatives: [] },
  { category: "成语", emoji: "⚔️💧🔙", answer: "背水一战", alternatives: [] },
  { category: "成语", emoji: "❤️🎋", answer: "胸有成竹", alternatives: [] },
  { category: "成语", emoji: "🔪🥩😌", answer: "游刃有余", alternatives: [] },
  { category: "成语", emoji: "🐴🧭❌", answer: "南辕北辙", alternatives: [] },
  { category: "成语", emoji: "🌊🚢👉", answer: "顺水推舟", alternatives: [] },
  { category: "成语", emoji: "🏰🔇🤫", answer: "空城计", alternatives: [] },
  { category: "成语", emoji: "💃💔", answer: "美人计", alternatives: [] },
  { category: "成语", emoji: "🐔🐶💨", answer: "鸡飞狗跳", alternatives: [] },

  // ===== 影视类（用关键角色/元素组合联想，不直接拼标题字面）=====
  { category: "影视", emoji: "🐒🐷🐴👨‍🦲", answer: "西游记", alternatives: ["大话西游", "Journey to the West"] },
  { category: "影视", emoji: "👑👑👑🌸🤝", answer: "三国演义", alternatives: ["三国"] },
  { category: "影视", emoji: "💧⛰️👥", answer: "水浒传", alternatives: ["水浒"] },
  { category: "影视", emoji: "💎🏰😔", answer: "红楼梦", alternatives: [] },
  { category: "影视", emoji: "🌍🚀☀️💥", answer: "流浪地球", alternatives: [] },
  { category: "影视", emoji: "🐺🔫🇨🇳", answer: "战狼2", alternatives: ["战狼", "Wolf Warrior"] },
  { category: "影视", emoji: "❄️🏔️🔫", answer: "长津湖", alternatives: [] },
  { category: "影视", emoji: "👶🔥🌊⚔️", answer: "哪吒之魔童降世", alternatives: ["哪吒", "哪吒降世"] },
  { category: "影视", emoji: "🚢💔🧊", answer: "泰坦尼克号", alternatives: ["泰坦尼克", "Titanic"] },
  { category: "影视", emoji: "🧙‍♂️⚡📚", answer: "哈利波特", alternatives: ["Harry Potter", "哈利·波特"] },
  { category: "影视", emoji: "💍🌋👹", answer: "指环王", alternatives: ["魔戒", "Lord of the Rings"] },
  { category: "影视", emoji: "🕷️👦", answer: "蜘蛛侠", alternatives: ["Spider-Man"] },
  { category: "影视", emoji: "🦇🦸", answer: "蝙蝠侠", alternatives: ["Batman"] },
  { category: "影视", emoji: "❄️👸", answer: "冰雪奇缘", alternatives: ["Frozen"] },
  { category: "影视", emoji: "🐼🥋", answer: "功夫熊猫", alternatives: ["Kung Fu Panda"] },
  { category: "影视", emoji: "💙👽🌊", answer: "阿凡达", alternatives: ["Avatar"] },
  { category: "影视", emoji: "🦸‍♂️🦸‍♀️🤝", answer: "复仇者联盟", alternatives: ["Avengers", "妇联"] },
  { category: "影视", emoji: "🤖🚗💥", answer: "变形金刚", alternatives: ["Transformers"] },
  { category: "影视", emoji: "🏎️💨🔥", answer: "速度与激情", alternatives: ["速激", "Fast & Furious"] },
  { category: "影视", emoji: "🦊🐰👮", answer: "疯狂动物城", alternatives: ["Zootopia"] },
  { category: "影视", emoji: "🧜‍♀️🐟🌊", answer: "美人鱼", alternatives: ["海的女儿"] },
  { category: "影视", emoji: "👩👧❤️⏰", answer: "你好李焕英", alternatives: ["李焕英"] },
  { category: "影视", emoji: "👑🐱", answer: "狮子王", alternatives: ["Lion King"] },
  { category: "影视", emoji: "🌸🗡️🐎", answer: "花木兰", alternatives: ["Mulan", "木兰"] },
  { category: "影视", emoji: "🎸💀👦", answer: "寻梦环游记", alternatives: ["Coco"] },
  { category: "影视", emoji: "🏠🎈🧓", answer: "飞屋环游记", alternatives: ["Up"] },
  { category: "影视", emoji: "🧠😃😢", answer: "头脑特工队", alternatives: ["Inside Out"] },
  { category: "影视", emoji: "⭐⚔️🚀", answer: "星球大战", alternatives: ["Star Wars"] },
  { category: "影视", emoji: "🏴‍☠️⛵🏝️", answer: "加勒比海盗", alternatives: ["Pirates of the Caribbean"] },
  { category: "影视", emoji: "💻🕶️🟢", answer: "黑客帝国", alternatives: ["The Matrix", "矩阵"] },
  { category: "影视", emoji: "🐒👑🔥", answer: "大圣归来", alternatives: ["西游记之大圣归来"] },
  { category: "影视", emoji: "🗡️🩸📜", answer: "满江红", alternatives: [] },
  { category: "影视", emoji: "🏯✈️📜", answer: "长安三万里", alternatives: [] },
  { category: "影视", emoji: "🏮⚔️👑", answer: "封神第一部", alternatives: ["封神"] },
  { category: "影视", emoji: "🥊⛩️👦", answer: "八角笼中", alternatives: [] },
  { category: "影视", emoji: "👰❓🔍", answer: "消失的她", alternatives: [] },
  { category: "影视", emoji: "🤠🚀⭐", answer: "玩具总动员", alternatives: ["Toy Story"] },
  { category: "影视", emoji: "🐠🔍🐟", answer: "海底总动员", alternatives: ["Finding Nemo", "寻找尼莫"] },
  { category: "影视", emoji: "🤖🌱❤️", answer: "机器人总动员", alternatives: ["WALL·E", "瓦力"] },
  { category: "影视", emoji: "🦸‍♂️🦸‍♀️💥", answer: "超人总动员", alternatives: ["The Incredibles"] },
  { category: "影视", emoji: "🥋💥👊", answer: "功夫", alternatives: ["Kung Fu"] },
  // —— 手写补充（AI 生成质量不稳定，改为手写保证质量）——
  { category: "影视", emoji: "🏪🔍🕵️", answer: "唐人街探案", alternatives: ["唐探"] },
  { category: "影视", emoji: "💤🎓😂", answer: "夏洛特烦恼", alternatives: [] },
  { category: "影视", emoji: "🐻🌲🏃", answer: "熊出没", alternatives: [] },
  { category: "影视", emoji: "🐑🐺🪤", answer: "喜羊羊与灰太狼", alternatives: ["喜羊羊"] },
  { category: "影视", emoji: "🦖🦕🏞️", answer: "侏罗纪公园", alternatives: ["Jurassic Park"] },
  { category: "影视", emoji: "🔩🦸‍♂️💥", answer: "钢铁侠", alternatives: ["Iron Man"] },
  { category: "影视", emoji: "🐆👑", answer: "黑豹", alternatives: ["Black Panther"] },
  { category: "影视", emoji: "🟢👹👂", answer: "怪物史莱克", alternatives: ["Shrek", "史莱克"] },
  { category: "影视", emoji: "🏮👹👶", answer: "捉妖记", alternatives: [] },
  { category: "影视", emoji: "💊🛒😭", answer: "我不是药神", alternatives: [] },
];

// === 工具函数 ===

/** emoji 字段是否包含禁止字符（汉字/英文字母/数字） */
function hasForbiddenChars(emoji) {
  if (typeof emoji !== "string" || !emoji) return true;
  // 只允许 emoji 符号、连接符(+ - 空格)、ZWJ(\u200D)、变体选择符(\uFE0F)、组合用记号等
  // 拒绝汉字、英文字母、数字
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(emoji);
}

/** 用 Intl.Segmenter 统计 emoji 簇数量（正确处理 ZWJ 序列） */
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function emojiCount(str) {
  if (typeof str !== "string") return 0;
  // 过滤掉纯空白和连接符后统计
  const cleaned = str.replace(/[\s+\-]/g, "");
  if (!cleaned) return 0;
  return [...segmenter.segment(cleaned)].length;
}

/** 规范化一条题目 */
function normalize(p) {
  if (!p || typeof p !== "object") return null;
  const emoji = String(p.emoji || "").trim();
  const answer = String(p.answer || "").trim();
  const category = String(p.category || "").trim();
  if (!emoji || !answer) return null;
  if (!["成语", "影视"].includes(category)) return null;
  if (hasForbiddenChars(emoji)) return null;
  const count = emojiCount(emoji);
  if (count < 2 || count > 8) return null;
  return {
    category,
    emoji,
    answer,
    alternatives: Array.isArray(p.alternatives)
      ? p.alternatives.map((a) => String(a).trim()).filter(Boolean).slice(0, 3)
      : [],
  };
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

/** 通用 prompt 模板：强调「元素组合联想」逻辑 */
function buildPrompt(category, count, avoidList) {
  const isIdiom = category === "成语";
  const examples = isIdiom
    ? `【成语示例 —— 学习这种逻辑】
  ✅ 🌳🐰👴⏳ → 守株待兔（树+兔+老农+等待，组合出故事场景）
  ✅ 🐍✏️🦶 → 画蛇添足（蛇+画笔+脚，组合出动作）
  ✅ 🍷🏹🐍 → 杯弓蛇影（杯+弓+蛇影，组合出场景）
  ✅ 🐑🔨🏠 → 亡羊补牢（羊+锤+圈，组合出修补动作）
  ✅ 🐦🏹😨 → 惊弓之鸟（鸟+弓+害怕，组合出受惊状态）
  ❌ 太直白：emoji 直接拼出成语字面（如用数字 9️⃣🐂1️⃣🦌 拼"九牛一毛"——禁止数字）`
    : `【影视示例 —— 学习这种逻辑】
  ✅ 🐒🐷🐴👨‍🦲 → 西游记（猴+猪+马+和尚=师徒四人，用角色组合联想作品）
  ✅ 🌍🚀☀️💥 → 流浪地球（地球+火箭+太阳+爆炸，用剧情元素联想）
  ✅ 🚢💔🧊 → 泰坦尼克号（船+心碎+冰山，用关键情节联想）
  ✅ 👑🐱 → 狮子王（皇冠+猫暗示"王+狮"，用暗喻而非直接画狮子戴冠）
  ❌ 太直白：🦁👑=狮子王（直接把答案画出来，玩家不用思考）`;

  const answerPool = isIdiom
    ? `守株待兔、画蛇添足、狐假虎威、井底之蛙、对牛弹琴、掩耳盗铃、刻舟求剑、惊弓之鸟、杀鸡儆猴、如鱼得水、鹤立鸡群、如虎添翼、指鹿为马、画龙点睛、亡羊补牢、闻鸡起舞、破釜沉舟、杯弓蛇影、叶公好龙、草木皆兵、风声鹤唳、四面楚歌、背水一战、买椟还珠、滥竽充数、自相矛盾、南辕北辙、缘木求鱼、抱薪救火、饮鸩止渴、釜底抽薪、趁火打劫、浑水摸鱼、瞒天过海、偷梁换柱、指桑骂槐、空城计、走为上计、火中取栗、杀鸡取卵、照猫画虎、画饼充饥、望梅止渴、游刃有余、胸有成竹、愚公移山、纸上谈兵、拔苗助长、杞人忧天、顺手牵羊、调虎离山、鹏程万里、狡兔三窟、水落石出、火上浇油、偷鸡摸狗、虎头蛇尾、口蜜腹剑、笑里藏刀、借刀杀人、顺水推舟、对答如流、破镜重圆、事半功倍、舍本逐末、喧宾夺主、舍近求远、避重就轻、扬汤止沸、反客为主、苦肉计、连环计`
    : `西游记、三国演义、水浒传、红楼梦、流浪地球、战狼2、你好李焕英、长津湖、哪吒之魔童降世、泰坦尼克号、阿凡达、复仇者联盟、蜘蛛侠、蝙蝠侠、超人、哈利波特、指环王、黑客帝国、速度与激情、变形金刚、星球大战、加勒比海盗、冰雪奇缘、疯狂动物城、寻梦环游记、飞屋环游记、头脑特工队、超人总动员、机器人总动员、海底总动员、狮子王、花木兰、功夫熊猫、功夫、大话西游、美人鱼、唐人街探案、满江红、消失的她、八角笼中、封神第一部、长安三万里、熊出没、喜羊羊与灰太狼、玩具总动员、怪物史莱克、蚁人、黑豹、钢铁侠、美国队长、雷神、奇异博士、生化危机、侏罗纪公园、捉妖记、夏洛特烦恼、我不是药神、流浪地球2、满江红、无名之辈、少年的你、送你一朵小红花`;

  return `你是表情包猜词游戏的题目生成器。本次只生成【${category}】类题目，共 ${count} 题。

【核心逻辑 —— 元素组合联想】
用多个 emoji 描述作品/成语里的【关键元素/角色/动作】，玩家通过组合这些元素联想出答案。
不是直接把答案画出来，而是给出能让人联想到答案的关键线索。

${examples}

【答案范围 —— 只能选大众熟知的${category}】
参考列表（也可选其他同等知名度的${category}，但必须家喻户晓）：
${answerPool}

【emoji 硬性要求 —— 违反即作废】
1. emoji 字段只能包含 emoji 字符和连接符（+、-、空格），绝对禁止任何汉字、英文字母、数字、标点。
   ❌ 错误：🐲腾🐯跃（含汉字）、1️⃣🐎当先（含数字）、Snowman（含字母）
   ✅ 正确：🐍✏️🦶、🚢💔🧊、🐒🐷🐴👨‍🦲
2. 每题 2-6 个 emoji
3. emoji 必须是真实存在的 emoji（不要杜撰不存在的组合）
4. 不能太直白（如 🦁👑=狮子王 直接画出答案，太简单）
5. 不能与答案完全无关

其他要求：
1. 答案用最常见的说法（如"西游记"而非"Journey to the West"）
2. alternatives 给 1-3 个别名/简称/英文名（可为空数组）
3. category 固定为"${category}"
${avoidList ? `4. 避免与这些已有题重复（emoji 和答案都不能撞）：${avoidList}` : ""}

请严格返回以下 JSON 格式（不要有任何其他文字）：
{"puzzles":[{"category":"${category}","emoji":"纯emoji","answer":"答案","alternatives":["别名"]}]}`;
}

/** 生成一批题目 */
async function generateBatch(category, count, avoidList) {
  const prompt = buildPrompt(category, count, avoidList);
  const messages = [
    { role: "system", content: "你是一个 JSON 生成器，只返回有效的 JSON，不要任何其他文字。" },
    { role: "user", content: prompt },
  ];
  const parsed = await callGLM(messages, 0.9, `[${category}]`);
  const list = Array.isArray(parsed.puzzles) ? parsed.puzzles : [];
  const result = [];
  for (const p of list) {
    const norm = normalize(p);
    if (norm) result.push(norm);
  }
  return result;
}

async function main() {
  console.log("🎯 表情包猜词题库重做脚本 v2 启动（元素组合联想逻辑）");
  console.log(`   模型: ${MODEL}`);
  console.log(`   手写种子题: ${SEED_PUZZLES.length} 题`);
  console.log(`   目标: 100 题（成语 50 + 影视 50），AI 补充扩展\n`);

  // 收集所有题目，先放种子
  const allPuzzles = [];
  const seenEmoji = new Set();
  const seenAnswer = new Set();
  let seedAdded = 0;
  let seedBad = 0;

  for (const p of SEED_PUZZLES) {
    const norm = normalize(p);
    if (!norm) {
      seedBad++;
      continue;
    }
    if (seenEmoji.has(norm.emoji) || seenAnswer.has(norm.answer)) continue;
    seenEmoji.add(norm.emoji);
    seenAnswer.add(norm.answer);
    allPuzzles.push(norm);
    seedAdded++;
  }
  console.log(`✓ 种子题入库: ${seedAdded} 题${seedBad ? `（${seedBad} 题格式不符已剔除）` : ""}`);
  const seedIdiom = allPuzzles.filter((p) => p.category === "成语").length;
  const seedMovie = allPuzzles.filter((p) => p.category === "影视").length;
  console.log(`   种子统计: 成语 ${seedIdiom} + 影视 ${seedMovie}\n`);

  // AI 补充生成
  const TARGET_PER_CATEGORY = 50;
  const BATCH_SIZE = 14;
  const aiStats = { 成语: 0, 影视: 0, filtered: 0 };

  for (const category of ["成语", "影视"]) {
    const current = allPuzzles.filter((p) => p.category === category).length;
    const need = TARGET_PER_CATEGORY - current;
    if (need <= 0) {
      console.log(`[${category}] 种子已满 ${current} 题，跳过 AI 生成`);
      continue;
    }
    const batches = Math.ceil(need / BATCH_SIZE) + 1; // 多生成一批以抵消去重损耗
    console.log(`[${category}] 还需 ${need} 题，分 ${batches} 批生成...`);

    for (let i = 0; i < batches; i++) {
      // 用已有答案做 avoid 列表，降低重复率
      const avoidList = allPuzzles
        .filter((p) => p.category === category)
        .slice(-20)
        .map((p) => p.answer)
        .join("、");
      try {
        const batch = await generateBatch(category, BATCH_SIZE, avoidList);
        let added = 0;
        let bad = 0;
        for (const p of batch) {
          if (seenEmoji.has(p.emoji) || seenAnswer.has(p.answer)) {
            bad++;
            continue;
          }
          seenEmoji.add(p.emoji);
          seenAnswer.add(p.answer);
          allPuzzles.push(p);
          added++;
          aiStats[category]++;
        }
        console.log(`   [${category} 批 ${i + 1}/${batches}] 返回 ${batch.length} 题，新增 ${added} 题${bad ? `，重复 ${bad}` : ""}（累计 ${allPuzzles.length}）`);
        // 达标即止
        const now = allPuzzles.filter((p) => p.category === category).length;
        if (now >= TARGET_PER_CATEGORY) {
          console.log(`   ✓ ${category} 已达 ${now} 题，停止`);
          break;
        }
      } catch (err) {
        console.error(`   ✗ [${category} 批 ${i + 1}] 失败: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // 重新编号 id（从 1 开始；成语在前，影视在后）
  allPuzzles.sort((a, b) => {
    if (a.category !== b.category) return a.category === "成语" ? -1 : 1;
    return 0;
  });
  const finalPuzzles = allPuzzles.map((p, idx) => ({ id: idx + 1, ...p }));

  const dataPath = path.join(__dirname, "..", "api", "data", "emoji-puzzles.json");
  fs.writeFileSync(dataPath, JSON.stringify(finalPuzzles, null, 2) + "\n", "utf-8");

  const statIdiom = finalPuzzles.filter((p) => p.category === "成语").length;
  const statMovie = finalPuzzles.filter((p) => p.category === "影视").length;
  console.log(`\n📊 生成完成：共 ${finalPuzzles.length} 题（成语 ${statIdiom} + 影视 ${statMovie}）`);
  console.log(`   AI 新增: 成语 ${aiStats.成语} + 影视 ${aiStats.影视}`);
  console.log(`✅ 题库已重写：${dataPath}`);
}

main().catch((err) => {
  console.error("💥 脚本异常:", err);
  process.exit(1);
});
