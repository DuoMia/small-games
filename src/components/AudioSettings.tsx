import { useState } from "react";
import { Volume2, VolumeX, Music, Music2, X } from "lucide-react";
import { useAudioStore } from "@/store/audioStore";

export default function AudioSettings() {
  const [open, setOpen] = useState(false);
  const {
    bgmEnabled,
    sfxEnabled,
    bgmVolume,
    sfxVolume,
    toggleBgm,
    toggleSfx,
    setBgmVolume,
    setSfxVolume,
  } = useAudioStore();

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed top-3 right-3 z-50 w-10 h-10 rounded-full bg-white border-2 border-ink shadow-pop flex items-center justify-center btn-press"
        aria-label="音频设置"
      >
        {bgmEnabled || sfxEnabled ? (
          <Volume2 size={18} className="text-ink" />
        ) : (
          <VolumeX size={18} className="text-ink" />
        )}
      </button>

      {/* 设置面板 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5" onClick={() => setOpen(false)}>
          <div
            className="bg-cream rounded-doodle border-3 border-ink shadow-card p-5 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl text-ink">音频设置</h2>
              <button onClick={() => setOpen(false)} className="btn-press p-1">
                <X size={20} className="text-ink" />
              </button>
            </div>

            {/* BGM 开关 */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-display text-ink flex items-center gap-2 text-sm">
                  <Music size={16} />
                  背景音乐
                </span>
                <button
                  onClick={toggleBgm}
                  className={`relative w-12 h-6 rounded-full border-2 border-ink transition-colors ${bgmEnabled ? "bg-mint" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white border border-ink rounded-full transition-transform ${bgmEnabled ? "translate-x-6" : "translate-x-0.5"}`} />
                </button>
              </div>
              {bgmEnabled && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={bgmVolume}
                  onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                  className="w-full accent-coral"
                />
              )}
            </div>

            {/* 音效开关 */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="font-display text-ink flex items-center gap-2 text-sm">
                  <Music2 size={16} />
                  游戏音效
                </span>
                <button
                  onClick={toggleSfx}
                  className={`relative w-12 h-6 rounded-full border-2 border-ink transition-colors ${sfxEnabled ? "bg-mint" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white border border-ink rounded-full transition-transform ${sfxEnabled ? "translate-x-6" : "translate-x-0.5"}`} />
                </button>
              </div>
              {sfxEnabled && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={sfxVolume}
                  onChange={(e) => setSfxVolume(parseFloat(e.target.value))}
                  className="w-full accent-coral"
                />
              )}
            </div>

            <p className="text-xs text-ink-muted mt-3 text-center">
              设置自动保存
            </p>
          </div>
        </div>
      )}
    </>
  );
}
