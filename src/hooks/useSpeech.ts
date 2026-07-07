import { useState, useRef, useEffect, useCallback } from "react";

// Web Speech API 类型声明（浏览器兼容）
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: { new (): SpeechRecognitionLike };
  webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
}

/**
 * 封装 Web Speech API 语音识别
 * lang: "zh-CN"
 * 不支持浏览器时 supported=false
 */
export function useSpeech() {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理超时兜底计时器
  const clearTimeoutFallback = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // 检测浏览器是否支持（Vite SPA，可直接在初始化时检测）
  const [supported, setSupported] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const w = window as WindowWithSpeech;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  });

  // 兜底：万一初始化时 window 还没就绪，再检测一次
  useEffect(() => {
    if (supported) return;
    const w = window as WindowWithSpeech;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (Ctor) setSupported(true);
  }, [supported]);

  const start = useCallback(() => {
    const w = window as WindowWithSpeech;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setError("当前浏览器不支持语音识别，请用文字输入");
      return;
    }
    // 停止之前的实例
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = false;

    // 开始录音时清空 transcript 和 error
    setTranscript("");
    setError(null);

    rec.onstart = () => {
      setListening(true);
    };

    rec.onresult = (event: any) => {
      // 取最后一句话
      const result = event.results?.[event.results.length - 1]?.[0]?.transcript || "";
      setTranscript(result);
      // 已拿到结果，清除超时兜底
      clearTimeoutFallback();
    };

    rec.onerror = (event: any) => {
      clearTimeoutFallback();
      const errType = event?.error || "";
      let msg = "语音识别失败";
      if (errType === "not-allowed" || errType === "service-not-allowed") {
        msg = "麦克风权限被拒绝，请用文字输入";
      } else if (errType === "no-speech") {
        msg = "没听到声音，请重试或用文字输入";
      } else if (errType === "network") {
        msg = "网络错误，请用文字输入";
      } else if (errType === "aborted") {
        msg = "";
      }
      if (msg) setError(msg);
      setListening(false);
    };

    rec.onend = () => {
      clearTimeoutFallback();
      setListening(false);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      // 超时兜底：8 秒内若未触发 onend/onresult 则强制停止，防止 listening 卡死
      clearTimeoutFallback();
      timeoutRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch {}
          recognitionRef.current = null;
        }
        setListening(false);
      }, 8000);
    } catch (err) {
      setError("无法启动语音识别，请用文字输入");
      setListening(false);
    }
  }, [clearTimeoutFallback]);

  const stop = useCallback(() => {
    clearTimeoutFallback();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setListening(false);
    }
  }, [clearTimeoutFallback]);

  const abort = useCallback(() => {
    clearTimeoutFallback();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    setListening(false);
  }, [clearTimeoutFallback]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearTimeoutFallback();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
    };
  }, [clearTimeoutFallback]);

  return {
    listening,
    transcript,
    start,
    stop,
    abort,
    supported,
    error,
  };
}
