import { useState, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "up-to-date"
  | "error";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  progress: number;
  error: string | null;
  checkForUpdates: () => void;
  installUpdate: () => void;
}

export function useUpdater(): UpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Awaited<ReturnType<typeof check>> | null>(null);

  const checkForUpdates = useCallback(async () => {
    setStatus("checking");
    setError(null);
    try {
      const update = await check();
      if (update) {
        setVersion(update.version);
        setPendingUpdate(update);
        setStatus("available");
      } else {
        setStatus("up-to-date");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!pendingUpdate) return;
    setStatus("downloading");
    setProgress(0);
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          setProgress(0);
        } else if (event.event === "Progress") {
          setProgress((prev) => prev + event.data.chunkLength);
        } else if (event.event === "Finished") {
          setStatus("ready");
        }
      });
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [pendingUpdate]);

  return { status, version, progress, error, checkForUpdates, installUpdate };
}
