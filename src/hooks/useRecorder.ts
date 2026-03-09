import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AudioFormat } from "../components/FormatSelector";

export type RecordingState = "idle" | "recording" | "done";

interface RecordingStatus {
  is_recording: boolean;
  peak_level: number;
}

export function useRecorder() {
  const [state, setState] = useState<RecordingState>("idle");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<AudioFormat>("wav");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const path = await invoke<string>("start_recording", { format });
      setFilePath(path);
      setState("recording");
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);

      pollRef.current = setInterval(async () => {
        try {
          const status = await invoke<RecordingStatus>("get_status");
          setPeakLevel(status.peak_level);
        } catch {
          // ignore polling errors
        }
      }, 50);
    } catch (e) {
      setError(String(e));
    }
  }, [format]);

  const stopRecording = useCallback(async () => {
    try {
      clearTimers();
      const path = await invoke<string | null>("stop_recording");
      if (path) setFilePath(path);
      setPeakLevel(0);
      setState("done");
    } catch (e) {
      setError(String(e));
    }
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setState("idle");
    setFilePath(null);
    setDuration(0);
    setPeakLevel(0);
    setError(null);
  }, [clearTimers]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  return {
    state,
    filePath,
    duration,
    peakLevel,
    error,
    format,
    setFormat,
    startRecording,
    stopRecording,
    reset,
  };
}
