// BGM 管理：用 Web Audio API 合成轻快循环乐曲，无需音频文件
// 结构：4 小节循环（C - G - Am - F 进行）
// 三轨道：主旋律（三角波）+ 低音（正弦）+ 鼓点（kick/snare/hi-hat）
// 外加和弦垫（三角波长音）

import { ensureCtx } from "./engine";

let bgmTimer: number | null = null;
let bgmGain: GainNode | null = null;
let bgmEnabled = false;
let bgmVolume = 0.4;
let currentCtx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

// ===== 节奏参数 =====
const BEAT = 0.5; // 每拍 0.5s（BPM=120）
const STEPS_PER_BAR = 8; // 每小节 8 个 8 分音符
const STEP = BEAT / 2; // 0.25s
const BARS = 4; // 4 小节循环
const TOTAL_STEPS = BARS * STEPS_PER_BAR; // 32 步
const BAR_DUR = BEAT * 4; // 每小节 2s

// ===== 和弦进行（C - G - Am - F）=====
// 每个和弦：[根音, 三音, 五音]
const CHORDS: number[][] = [
  [261.63, 329.63, 392.0], // C:  C4-E4-G4
  [196.0, 246.94, 293.66], // G:  G3-B3-D4
  [220.0, 261.63, 329.63], // Am: A3-C4-E4
  [174.61, 220.0, 261.63], // F:  F3-A3-C4
];
const BASS_ROOTS = [130.81, 98.0, 110.0, 87.31]; // C3, G2, A2, F2

// ===== 主旋律（4小节 × 8步，含休止与节奏变化）=====
// null = 休止；{ f: 频率, d: 时值(拍) }
type MelodyNote = { f: number; d: number } | null;
const MELODY: MelodyNote[] = [
  // 小节1 (C): C5 -- E5 -- G5(长) -- E5 G5
  { f: 523.25, d: 0.5 }, null, { f: 659.25, d: 0.5 }, null,
  { f: 783.99, d: 1.0 }, null, { f: 659.25, d: 0.5 }, { f: 783.99, d: 0.5 },
  // 小节2 (G): D5 -- G5 -- B4(长) -- G5 D5
  { f: 587.33, d: 0.5 }, null, { f: 783.99, d: 0.5 }, null,
  { f: 493.88, d: 1.0 }, null, { f: 783.99, d: 0.5 }, { f: 587.33, d: 0.5 },
  // 小节3 (Am): C5 -- E5 -- A4(长) -- C5 E5
  { f: 523.25, d: 0.5 }, null, { f: 659.25, d: 0.5 }, null,
  { f: 440.0, d: 1.0 }, null, { f: 523.25, d: 0.5 }, { f: 659.25, d: 0.5 },
  // 小节4 (F): F5 -- A5 -- C5(长) -- A4 F4
  { f: 698.46, d: 0.5 }, null, { f: 880.0, d: 0.5 }, null,
  { f: 523.25, d: 1.0 }, null, { f: 440.0, d: 0.5 }, { f: 349.23, d: 0.5 },
];

// ===== 低音：每小节第 1, 5 步（拍 1, 3）=====
const BASS_STEPS = new Set([0, 4]);

// ===== 鼓点（每步一种）=====
// kick: 拍 1, 3；snare: 拍 2, 4；hihat: 所有 8 分音符
type DrumType = "kick" | "snare" | "hihat" | null;
const DRUMS: DrumType[] = [
  // 小节内 8 步：0    1       2       3       4     5       6       7
  "kick", "hihat", "snare", "hihat", "kick", "hihat", "snare", "hihat",
];

let stepIdx = 0;
let nextStepTime = 0;

/** 创建白噪声 buffer（用于 snare/hihat） */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const len = ctx.sampleRate * 0.3;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** 合成主旋律音符（三角波） */
function playMelodyNote(ctx: AudioContext, dest: GainNode, freq: number, dur: number, when: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(bgmVolume * 0.16, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.95);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + dur);
}

/** 合成低音（正弦波，柔和） */
function playBassNote(ctx: AudioContext, dest: GainNode, freq: number, when: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(bgmVolume * 0.18, when + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, when + BEAT * 0.9);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + BEAT);
}

/** 合成和弦垫（三个三角波，长音） */
function playPad(ctx: AudioContext, dest: GainNode, freqs: number[], when: number) {
  freqs.forEach((f) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(bgmVolume * 0.05, when + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, when + BAR_DUR * 0.95);
    osc.connect(g);
    g.connect(dest);
    osc.start(when);
    osc.stop(when + BAR_DUR);
  });
}

/** 合成 kick（正弦波 150→50Hz 下滑） */
function playKick(ctx: AudioContext, dest: GainNode, when: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, when);
  osc.frequency.exponentialRampToValueAtTime(50, when + 0.1);
  g.gain.setValueAtTime(bgmVolume * 0.3, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + 0.2);
}

/** 合成 snare（噪声 + 200Hz 正弦） */
function playSnare(ctx: AudioContext, dest: GainNode, when: number) {
  // 噪声部分
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const ng = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1000;
  ng.gain.setValueAtTime(bgmVolume * 0.18, when);
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
  src.connect(filter);
  filter.connect(ng);
  ng.connect(dest);
  src.start(when);
  src.stop(when + 0.13);
  // 音调部分
  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(200, when);
  og.gain.setValueAtTime(bgmVolume * 0.1, when);
  og.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
  osc.connect(og);
  og.connect(dest);
  osc.start(when);
  osc.stop(when + 0.11);
}

/** 合成 hi-hat（高通噪声，短促） */
function playHihat(ctx: AudioContext, dest: GainNode, when: number) {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const ng = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 7000;
  ng.gain.setValueAtTime(bgmVolume * 0.08, when);
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  src.connect(filter);
  filter.connect(ng);
  ng.connect(dest);
  src.start(when);
  src.stop(when + 0.06);
}

function scheduleStep() {
  if (!bgmEnabled || !currentCtx || !bgmGain) return;
  const now = currentCtx.currentTime;
  // 提前 0.2s 调度
  while (nextStepTime < now + 0.3) {
    const bar = Math.floor(stepIdx / STEPS_PER_BAR) % BARS;
    const stepInBar = stepIdx % STEPS_PER_BAR;
    const when = nextStepTime;

    // 主旋律
    const note = MELODY[stepIdx % TOTAL_STEPS];
    if (note) {
      playMelodyNote(currentCtx, bgmGain, note.f, note.d * BEAT, when);
    }

    // 低音（每小节第 1, 5 步）
    if (BASS_STEPS.has(stepInBar)) {
      playBassNote(currentCtx, bgmGain, BASS_ROOTS[bar], when);
    }

    // 和弦垫（每小节开始）
    if (stepInBar === 0) {
      playPad(currentCtx, bgmGain, CHORDS[bar], when);
    }

    // 鼓点
    const drum = DRUMS[stepInBar];
    if (drum === "kick") playKick(currentCtx, bgmGain, when);
    else if (drum === "snare") playSnare(currentCtx, bgmGain, when);
    else if (drum === "hihat") playHihat(currentCtx, bgmGain, when);

    nextStepTime += STEP;
    stepIdx = (stepIdx + 1) % TOTAL_STEPS;
  }
  bgmTimer = window.setTimeout(scheduleStep, 100);
}

export function startBgm() {
  const ctx = ensureCtx();
  if (!ctx) return;
  currentCtx = ctx;
  if (!bgmGain) {
    bgmGain = ctx.createGain();
    bgmGain.gain.value = 1;
    bgmGain.connect(ctx.destination);
  }
  bgmEnabled = true;
  nextStepTime = ctx.currentTime + 0.1;
  stepIdx = 0;
  if (bgmTimer === null) {
    scheduleStep();
  }
}

export function stopBgm() {
  bgmEnabled = false;
  if (bgmTimer !== null) {
    clearTimeout(bgmTimer);
    bgmTimer = null;
  }
}

export function setBgmVolume(v: number) {
  bgmVolume = v;
}

export function setBgmMuted(muted: boolean) {
  if (bgmGain && currentCtx) {
    bgmGain.gain.setTargetAtTime(muted ? 0 : 1, currentCtx.currentTime, 0.1);
  }
}

export function isBgmPlaying() {
  return bgmEnabled;
}
