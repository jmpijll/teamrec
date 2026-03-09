import { useRef, useEffect, useState } from "react";
import { cn } from "../lib/utils";

interface AudioMeterProps {
  level: number;
  isActive: boolean;
}

const BARS = 32;
const DECAY = 0.92;
const PEAK_HOLD_MS = 600;

export function AudioMeter({ level, isActive }: AudioMeterProps) {
  const [smoothLevel, setSmoothLevel] = useState(0);
  const [peakBar, setPeakBar] = useState(0);
  const smoothRef = useRef(0);
  const peakRef = useRef(0);
  const peakTimerRef = useRef(0);
  const rafRef = useRef(0);

  // Reset when recording stops
  useEffect(() => {
    if (!isActive) {
      smoothRef.current = 0;
      peakRef.current = 0;
      // Use rAF to batch the reset outside the synchronous effect body
      const id = requestAnimationFrame(() => {
        setSmoothLevel(0);
        setPeakBar(0);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isActive]);

  // Animation loop while active
  useEffect(() => {
    if (!isActive) return;

    let running = true;
    const tick = () => {
      if (!running) return;

      // Smooth rise/fall
      const target = level;
      if (target > smoothRef.current) {
        smoothRef.current = target;
      } else {
        smoothRef.current *= DECAY;
      }

      // Peak hold
      const currentBars = Math.round(smoothRef.current * BARS);
      if (currentBars > peakRef.current) {
        peakRef.current = currentBars;
        peakTimerRef.current = Date.now();
      } else if (Date.now() - peakTimerRef.current > PEAK_HOLD_MS) {
        peakRef.current = Math.max(0, peakRef.current - 1);
      }

      setSmoothLevel(smoothRef.current);
      setPeakBar(peakRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, level]);

  const activeBars = Math.round(smoothLevel * BARS);

  return (
    <div className="flex items-end justify-center gap-[3px] h-20 px-4">
      {Array.from({ length: BARS }, (_, i) => {
        const isLit = isActive && i < activeBars;
        const isPeak = isActive && i === peakBar - 1 && peakBar > 0;
        const intensity = i / BARS;

        const color = isLit
          ? intensity > 0.85
            ? "bg-record shadow-[0_0_6px_var(--color-record-glow)]"
            : intensity > 0.65
              ? "bg-yellow-400"
              : "bg-success"
          : isPeak
            ? "bg-text-muted"
            : "bg-border/60";

        return (
          <div
            key={i}
            className={cn("w-[4.5px] rounded-full transition-colors duration-75", color)}
            style={{
              height: isLit
                ? `${Math.max(24, (i / BARS) * 100)}%`
                : `${Math.max(10, ((i + 1) / BARS) * 30)}%`,
              transition: isLit
                ? "height 50ms ease-out, background-color 75ms"
                : "height 120ms ease-in, background-color 75ms",
            }}
          />
        );
      })}
    </div>
  );
}
