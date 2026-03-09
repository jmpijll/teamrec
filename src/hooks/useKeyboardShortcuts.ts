import { useEffect } from "react";

export interface ShortcutConfig {
  record: string;
  stop: string;
}

interface KeyboardShortcutOptions {
  onRecord: () => void;
  onStop: () => void;
  isRecording: boolean;
  canRecord: boolean;
  disabled?: boolean;
  shortcuts?: ShortcutConfig;
}

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+").map((s) => s.trim());
  const key = parts[parts.length - 1];
  const needCtrl = parts.includes("ctrl") || parts.includes("cmd") || parts.includes("meta");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");

  if (needCtrl && !(e.ctrlKey || e.metaKey)) return false;
  if (needShift && !e.shiftKey) return false;
  if (needAlt && !e.altKey) return false;
  return e.key.toLowerCase() === key;
}

export function useKeyboardShortcuts({
  onRecord,
  onStop,
  isRecording,
  canRecord,
  disabled = false,
  shortcuts = { record: "ctrl+r", stop: "ctrl+s" },
}: KeyboardShortcutOptions) {
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      ) {
        return;
      }

      // Custom record shortcut
      if (matchesShortcut(e, shortcuts.record)) {
        e.preventDefault();
        if (!isRecording && canRecord) {
          onRecord();
        }
      }

      // Custom stop shortcut
      if (matchesShortcut(e, shortcuts.stop)) {
        e.preventDefault();
        if (isRecording) {
          onStop();
        }
      }

      // Escape — always stops recording
      if (e.key === "Escape" && isRecording) {
        e.preventDefault();
        onStop();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onRecord, onStop, isRecording, canRecord, disabled, shortcuts]);
}
