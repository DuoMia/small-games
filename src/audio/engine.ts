// Web Audio API 音频引擎 + 合成音效
// 所有音效用 OscillatorNode + GainNode 合成，0 KB 音频文件

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let unlocked = false;

/** 获取/创建 AudioContext（必须在 user gesture 后调用） */
export function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.6;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  unlocked = true;
  return audioCtx;
}

/** 解锁音频（首页任意按钮首次点击时调用） */
export function unlockAudio() {
  ensureCtx();
}

/** 设置主音量（音效） */
export function setSfxMasterVolume(v: number) {
  if (masterGain) masterGain.gain.value = v;
}

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  startGain: number = 0.3,
  delay: number = 0
) {
  const ctx = ensureCtx();
  if (!ctx || !masterGain) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // 包络：快速起，指数衰减
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(startGain, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function playChord(freqs: number[], duration: number, type: OscillatorType = "sine", startGain = 0.2) {
  freqs.forEach((f) => playTone(f, duration, type, startGain));
}

// ===== 音效函数 =====

export const sfx = {
  click() {
    playTone(1000, 0.05, "square", 0.18);
  },
  tick() {
    playTone(880, 0.06, "sine", 0.2);
  },
  tickUrgent() {
    playTone(1200, 0.08, "square", 0.25);
  },
  correct() {
    playChord([1318, 1760], 0.3, "sine", 0.18);
  },
  wrong() {
    playTone(200, 0.25, "sawtooth", 0.2);
  },
  roundEnd() {
    playTone(523, 0.12, "sine", 0.2, 0);
    playTone(659, 0.12, "sine", 0.2, 0.12);
    playTone(784, 0.2, "sine", 0.2, 0.24);
  },
  win() {
    // 上行欢快
    playTone(523, 0.1, "sine", 0.22, 0);
    playTone(659, 0.1, "sine", 0.22, 0.1);
    playTone(784, 0.1, "sine", 0.22, 0.2);
    playTone(1047, 0.3, "sine", 0.25, 0.3);
  },
  lose() {
    // 下行小调
    playTone(392, 0.15, "sine", 0.2, 0);
    playTone(330, 0.15, "sine", 0.2, 0.15);
    playTone(262, 0.3, "sine", 0.2, 0.3);
  },
  opponentJoin() {
    playTone(660, 0.08, "sine", 0.2, 0);
    playTone(880, 0.12, "sine", 0.2, 0.08);
  },
  opponentAnswered() {
    playTone(990, 0.1, "sine", 0.18);
  },
  uiTick() {
    playTone(1500, 0.03, "square", 0.12);
  },
};

export function isAudioUnlocked() {
  return unlocked;
}
