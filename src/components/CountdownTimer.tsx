import { useEffect, useState, useRef } from "react";

interface CountdownTimerProps {
  duration: number; // 秒
  onEnd?: () => void;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export default function CountdownTimer({
  duration,
  onEnd,
  size = "md",
  showLabel = false,
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(duration);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    setRemaining(duration);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, duration - elapsed);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(interval);
        onEndRef.current?.();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [duration]);

  const seconds = Math.ceil(remaining);
  const isUrgent = seconds <= 3 && seconds > 0;
  const progress = (remaining / duration) * 100;

  const sizeClasses = {
    sm: "text-lg w-12 h-12",
    md: "text-2xl w-16 h-16",
    lg: "text-5xl w-24 h-24",
  };

  if (showLabel) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div
          className={`font-display flex items-center justify-center rounded-full ${sizeClasses[size]} ${
            isUrgent
              ? "bg-coral text-white animate-pulse-scale"
              : "bg-ink text-cream"
          }`}
        >
          {seconds}
        </div>
        {duration > 10 && (
          <div className="w-24 h-1.5 bg-cream-dark rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-100 ${
                isUrgent ? "bg-coral" : "bg-mint"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <span
      className={`font-display inline-flex items-center justify-center rounded-full ${sizeClasses[size]} ${
        isUrgent
          ? "bg-coral text-white animate-pulse-scale"
          : "bg-ink text-cream"
      }`}
    >
      {seconds}
    </span>
  );
}
