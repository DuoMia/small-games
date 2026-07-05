import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AudioSettingsState {
  bgmEnabled: boolean;
  sfxEnabled: boolean;
  bgmVolume: number; // 0~1
  sfxVolume: number; // 0~1
  setBgmEnabled: (v: boolean) => void;
  setSfxEnabled: (v: boolean) => void;
  setBgmVolume: (v: number) => void;
  setSfxVolume: (v: number) => void;
  toggleBgm: () => void;
  toggleSfx: () => void;
}

export const useAudioStore = create<AudioSettingsState>()(
  persist(
    (set) => ({
      bgmEnabled: true,
      sfxEnabled: true,
      bgmVolume: 0.4,
      sfxVolume: 0.6,
      setBgmEnabled: (v) => set({ bgmEnabled: v }),
      setSfxEnabled: (v) => set({ sfxEnabled: v }),
      setBgmVolume: (v) => set({ bgmVolume: Math.max(0, Math.min(1, v)) }),
      setSfxVolume: (v) => set({ sfxVolume: Math.max(0, Math.min(1, v)) }),
      toggleBgm: () => set((s) => ({ bgmEnabled: !s.bgmEnabled })),
      toggleSfx: () => set((s) => ({ sfxEnabled: !s.sfxEnabled })),
    }),
    { name: "small-game-audio" }
  )
);
