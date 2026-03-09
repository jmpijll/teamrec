import { cn } from "../lib/utils";

export type AudioFormat = "wav" | "flac" | "mp3";

interface FormatSelectorProps {
  value: AudioFormat;
  onChange: (format: AudioFormat) => void;
  disabled?: boolean;
}

const formats: { value: AudioFormat; label: string; desc: string }[] = [
  { value: "wav", label: "WAV", desc: "Lossless, large" },
  { value: "flac", label: "FLAC", desc: "Lossless, compact" },
  { value: "mp3", label: "MP3", desc: "Lossy, smallest" },
];

export function FormatSelector({ value, onChange, disabled }: FormatSelectorProps) {
  return (
    <div className="flex items-center gap-2 p-1.5 rounded-xl bg-bg-primary border border-border/40">
      {formats.map((fmt) => (
        <button
          key={fmt.value}
          onClick={() => onChange(fmt.value)}
          disabled={disabled}
          className={cn(
            "flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer",
            value === fmt.value
              ? "bg-accent text-white shadow-sm shadow-accent/20"
              : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated/50"
          )}
        >
          <span>{fmt.label}</span>
          <span className={cn(
            "text-[10px] font-normal",
            value === fmt.value ? "text-white/60" : "text-text-muted/40"
          )}>
            {fmt.desc}
          </span>
        </button>
      ))}
    </div>
  );
}
