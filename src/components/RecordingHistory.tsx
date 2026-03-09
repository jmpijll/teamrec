import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, FolderOpen, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";

interface RecordingInfo {
  path: string;
  filename: string;
  size: number;
  modified: string;
  format: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  // dateStr is "YYYY-MM-DD HH:MM:SS"
  const parts = dateStr.split(" ");
  if (parts.length < 2) return dateStr;
  const [date, time] = parts;
  return `${date} ${time.slice(0, 5)}`;
}

export function RecordingHistory() {
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<RecordingInfo[]>("list_recordings");
      setRecordings(list);
    } catch (e) {
      console.error("Failed to load recordings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = async (path: string) => {
    try {
      await invoke("delete_recording", { path });
      setRecordings((prev) => prev.filter((r) => r.path !== path));
    } catch (e) {
      console.error("Failed to delete recording:", e);
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await invoke("open_folder", { path });
    } catch (e) {
      console.error("Failed to open folder:", e);
    }
  };

  const formatBadgeColor = (format: string) => {
    switch (format) {
      case "wav":
        return "bg-accent/15 text-accent";
      case "flac":
        return "bg-success/15 text-success";
      case "mp3":
        return "bg-record/15 text-record";
      default:
        return "bg-text-muted/15 text-text-muted";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <RefreshCw className="w-4 h-4 text-text-muted/40 animate-spin" />
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <p className="text-[11px] text-text-muted/50 text-center py-4">
        No recordings yet
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header with refresh */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-text-muted/50">
          {recordings.length} recording{recordings.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={refresh}
          className="p-1.5 rounded-lg text-text-muted/40 hover:text-text-muted transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Recording list */}
      <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto pr-1">
        {recordings.map((rec) => (
          <div
            key={rec.path}
            className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-bg-primary/60 border border-border/30 hover:border-border/60 transition-colors"
          >
            {/* Format badge */}
            <span
              className={cn(
                "shrink-0 text-[9px] font-bold uppercase px-2 py-0.5 rounded-md",
                formatBadgeColor(rec.format)
              )}
            >
              {rec.format}
            </span>

            {/* File info */}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] text-text-primary truncate leading-snug">
                {rec.filename}
              </p>
              <p className="text-[10px] text-text-muted/50 leading-snug mt-0.5">
                {formatSize(rec.size)} · {formatDate(rec.modified)}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleOpenFolder(rec.path)}
                className="p-1.5 rounded-lg text-text-muted/40 hover:text-text-primary transition-colors cursor-pointer"
                title="Open folder"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(rec.path)}
                className="p-1.5 rounded-lg text-text-muted/40 hover:text-record transition-colors cursor-pointer"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
