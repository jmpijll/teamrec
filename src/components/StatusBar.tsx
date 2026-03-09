import { formatDuration } from "../lib/utils";

interface StatusBarProps {
  isRecording: boolean;
  duration: number;
}

export function StatusBar({ isRecording, duration }: StatusBarProps) {
  if (!isRecording) return null;

  return (
    <div className="flex items-center gap-3 animate-fade-in">
      {/* Pulsing red dot */}
      <div className="relative">
        <div className="w-2.5 h-2.5 rounded-full bg-record" />
        <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-record animate-ping" />
      </div>

      {/* Timer */}
      <span className="text-xl font-mono font-semibold text-text-primary tracking-wider">
        {formatDuration(duration)}
      </span>
    </div>
  );
}
