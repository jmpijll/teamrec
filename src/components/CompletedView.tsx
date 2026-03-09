import { CheckCircle, FolderOpen, RotateCcw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface CompletedViewProps {
  filePath: string | null;
  duration: number;
  onReset: () => void;
}

export function CompletedView({ filePath, duration, onReset }: CompletedViewProps) {
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const fileName = filePath?.split(/[/\\]/).pop() ?? "recording.wav";

  const openFolder = async () => {
    if (!filePath) return;
    try {
      await invoke("open_folder", { path: filePath });
    } catch (e) {
      console.error("Failed to open folder:", e);
    }
  };

  return (
    <div className="flex flex-col items-center gap-7 animate-fade-in">
      {/* Success icon */}
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-success/10 blur-xl" />
        <CheckCircle className="w-16 h-16 text-success relative z-10" strokeWidth={1.5} />
      </div>

      {/* Info */}
      <div className="text-center space-y-2">
        <p className="text-lg font-semibold text-text-primary">Recording saved</p>
        <p className="text-[13px] text-text-muted font-mono truncate max-w-[340px]">
          {fileName}
        </p>
        <p className="text-[13px] text-text-muted/60">
          {formatDuration(duration)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={openFolder}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-elevated border border-border/60 text-text-secondary hover:text-text-primary hover:border-border transition-all cursor-pointer text-[13px] font-medium"
        >
          <FolderOpen className="w-4 h-4" />
          Open Folder
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white hover:bg-accent-hover transition-all cursor-pointer text-[13px] font-medium"
        >
          <RotateCcw className="w-4 h-4" />
          New Recording
        </button>
      </div>
    </div>
  );
}
