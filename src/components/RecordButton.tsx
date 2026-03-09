import { Mic, Square } from "lucide-react";
import { cn } from "../lib/utils";

interface RecordButtonProps {
  isRecording: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function RecordButton({ isRecording, onClick, disabled }: RecordButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative w-24 h-24 rounded-full flex items-center justify-center",
        "transition-all duration-300 cursor-pointer",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
        disabled
          ? "bg-bg-elevated opacity-40 cursor-not-allowed"
          : isRecording
            ? "bg-record animate-pulse-record hover:bg-record/80"
            : "bg-accent hover:bg-accent-hover hover:scale-105 active:scale-95"
      )}
    >
      {/* Outer glow ring */}
      <div
        className={cn(
          "absolute inset-0 rounded-full transition-opacity duration-500",
          isRecording
            ? "opacity-100 shadow-[0_0_35px_var(--color-record-glow)]"
            : "opacity-0"
        )}
      />

      {/* Icon */}
      {isRecording ? (
        <Square className="w-8 h-8 text-white relative z-10" fill="white" />
      ) : (
        <Mic className="w-9 h-9 text-white relative z-10" />
      )}
    </button>
  );
}
