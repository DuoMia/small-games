// BGM 管理：用 Web Audio API 合成轻快循环旋律，无需音频文件
// 简单的 C 大调循环：C-E-G-A-G-E-C-E...

import { ensureCtx } from "./engine";

let bgmTimer: number | null = null;
let bgmGain: GainNode | null = null;
let bgmEnabled = false;
let bgmVolume = 0.4;
let currentCtx: AudioContext | null = null;

// 旋律（C大调五声音阶，轻快）
const MELODY: { freq: number; dur: number }[] = [
  { freq: 523.25, dur: 0.4 }, // C5
  { freq: 587.33, dur: 0.4 }, // D5
  { freq: 659.25, dur: 0.4 }, // E5
  { freq: 783.99, dur: 0.4 }, // G5
  { freq: 880.0, dur: 0.4 }, // A5
  { freq: 783.99, dur: 0.4 }, // G5
  { freq: 659.25, dur: 0.4 }, // E5
  { freq: 587.33, dur: 0.4 }, // D5
  { freq: 523.25, dur: 0.8 }, // C5 长
  { freq: 659.25, dur: 0.4 }, // E5
  { freq: 783.99, dur: 0.4 }, // G5
  { freq: 880.0, dur: 0.8 }, // A5 长
];

// 低音线
const BASS: { freq: number; dur: number }[] = [
  { freq: 130.81, dur: 1.6 }, // C3
  { freq: 130.81, dur: 1.6 }, // C3
  { freq: 196.0, dur: 1.6 }, // G3
  { freq: 130.81, dur: 1.6 }, // C3
];

let melodyIdx = 0;
let bassIdx = 0;
let nextNoteTime = 0;

function scheduleNote() {
  if (!bgmEnabled || !currentCtx || !bgmGain) return;
  const now = currentCtx.currentTime;
  // 提前 0.2s 调度
  while (nextNoteTime < now + 0.3) {
    // 旋律
    const note = MELODY[melodyIdx % MELODY.length];
    const osc = currentCtx.createOscillator();
    const g = currentCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(note.freq, nextNoteTime);
    g.gain.setValueAtTime(0.0001, nextNoteTime);
    g.gain.exponentialRampToValueAtTime(bgmVolume * 0.18, nextNoteTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, nextNoteTime + note.dur * 0.95);
    osc.connect(g);
    g.connect(bgmGain);
    osc.start(nextNoteTime);
    osc.stop(nextNoteTime + note.dur);

    // 低音（每 1.6s 换）
    if (melodyIdx % 4 === 0) {
      const bnote = BASS[bassIdx % BASS.length];
      const bosc = currentCtx.createOscillator();
      const bg = currentCtx.createGain();
      bosc.type = "sine";
      bosc.frequency.setValueAtTime(bnote.freq, nextNoteTime);
      bg.gain.setValueAtTime(0.0001, nextNoteTime);
      bg.gain.exponentialRampToValueAtTime(bgmVolume * 0.12, nextNoteTime + 0.05);
      bg.gain.exponentialRampToValueAtTime(0.0001, nextNoteTime + bnote.dur * 0.9);
      bosc.connect(bg);
      bg.connect(bgmGain);
      bosc.start(nextNoteTime);
      bosc.stop(nextNoteTime + bnote.dur);
      bassIdx++;
    }

    nextNoteTime += note.dur;
    melodyIdx++;
  }
  bgmTimer = window.setTimeout(scheduleNote, 100);
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
  nextNoteTime = ctx.currentTime + 0.1;
  melodyIdx = 0;
  bassIdx = 0;
  if (bgmTimer === null) {
    scheduleNote();
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
