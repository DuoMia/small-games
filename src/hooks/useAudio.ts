import { useEffect, useRef } from "react";
import { useAudioStore } from "@/store/audioStore";
import { sfx, unlockAudio, setSfxMasterVolume } from "@/audio/engine";
import { startBgm, stopBgm, setBgmVolume } from "@/audio/bgm";

// 标记是否已解锁（避免重复 unlock）
let audioUnlocked = false;

export function useAudio() {
  const { bgmEnabled, sfxEnabled, bgmVolume, sfxVolume } = useAudioStore();
  const bgmEnabledRef = useRef(bgmEnabled);
  bgmEnabledRef.current = bgmEnabled;

  // 首次 user gesture 解锁音频
  useEffect(() => {
    const unlock = () => {
      if (audioUnlocked) return;
      audioUnlocked = true;
      unlockAudio();
      // 解锁后若 BGM 开启，则启动
      if (bgmEnabledRef.current) {
        startBgm();
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // 同步 BGM 开关
  useEffect(() => {
    if (!audioUnlocked) return;
    if (bgmEnabled) {
      startBgm();
    } else {
      stopBgm();
    }
  }, [bgmEnabled]);

  // 同步 BGM 音量
  useEffect(() => {
    setBgmVolume(bgmVolume);
  }, [bgmVolume]);

  // 同步音效音量
  useEffect(() => {
    setSfxMasterVolume(sfxEnabled ? sfxVolume : 0);
  }, [sfxVolume, sfxEnabled]);

  return {
    playClick: () => sfxEnabled && sfx.click(),
    playTick: () => sfxEnabled && sfx.tick(),
    playTickUrgent: () => sfxEnabled && sfx.tickUrgent(),
    playCorrect: () => sfxEnabled && sfx.correct(),
    playWrong: () => sfxEnabled && sfx.wrong(),
    playRoundEnd: () => sfxEnabled && sfx.roundEnd(),
    playWin: () => sfxEnabled && sfx.win(),
    playLose: () => sfxEnabled && sfx.lose(),
    playOpponentJoin: () => sfxEnabled && sfx.opponentJoin(),
    playOpponentAnswered: () => sfxEnabled && sfx.opponentAnswered(),
    playUiTick: () => sfxEnabled && sfx.uiTick(),
  };
}
