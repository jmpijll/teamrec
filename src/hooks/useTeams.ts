import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AudioFormat } from "../components/FormatSelector";

interface TeamInfo {
  id: string;
  name: string;
}

interface ChannelInfo {
  id: string;
  name: string;
  team_id: string;
}

export type TeamsState = "disconnected" | "connected" | "recording" | "done";

export function useTeams() {
  const [state, setState] = useState<TeamsState>("disconnected");
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [peakLevel, setPeakLevel] = useState(0);
  const [duration, setDuration] = useState(0);
  const [savedPaths, setSavedPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

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

  const connect = useCallback(async (clientId: string, tenantId: string, clientSecret: string) => {
    try {
      setError(null);
      setConnecting(true);
      await invoke("teams_connect", { clientId, tenantId, clientSecret });
      await invoke("save_teams_credentials", { clientId, tenantId, clientSecret });
      const t = await invoke<TeamInfo[]>("teams_list_teams");
      setTeams(t);
      setState("connected");
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      clearTimers();
      await invoke("teams_disconnect");
      setState("disconnected");
      setTeams([]);
      setChannels([]);
      setSelectedTeam(null);
      setSelectedChannel(null);
      setPeakLevel(0);
    } catch (e) {
      setError(String(e));
    }
  }, [clearTimers]);

  const selectTeam = useCallback(async (teamId: string) => {
    try {
      setError(null);
      setSelectedTeam(teamId);
      setSelectedChannel(null);
      const chs = await invoke<ChannelInfo[]>("teams_list_channels", {
        teamId,
      });
      setChannels(chs);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const startRecording = useCallback(
    async (format: AudioFormat) => {
      if (!selectedTeam || !selectedChannel) {
        setError("Select a team and channel first");
        return;
      }
      try {
        setError(null);
        // Use per-process capture for Teams audio (same as local recording)
        const path = await invoke<string>("start_recording", { format });
        setSavedPaths([path]);
        setState("recording");
        setDuration(0);

        timerRef.current = setInterval(() => {
          setDuration((d) => d + 1);
        }, 1000);

        pollRef.current = setInterval(async () => {
          try {
            const status = await invoke<{ is_recording: boolean; peak_level: number }>("get_status");
            setPeakLevel(status.peak_level);
          } catch {
            // ignore
          }
        }, 50);
      } catch (e) {
        setError(String(e));
      }
    },
    [selectedTeam, selectedChannel]
  );

  const stopRecording = useCallback(async () => {
    try {
      clearTimers();
      const path = await invoke<string | null>("stop_recording");
      if (path) setSavedPaths([path]);
      setPeakLevel(0);
      setState("done");
    } catch (e) {
      setError(String(e));
    }
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setState("connected");
    setSavedPaths([]);
    setDuration(0);
    setPeakLevel(0);
    setError(null);
  }, [clearTimers]);

  // Load saved credentials on mount
  useEffect(() => {
    invoke<{ client_id: string; tenant_id: string; client_secret: string } | null>("load_teams_credentials").then((creds) => {
      if (creds) {
        connect(creds.client_id, creds.tenant_id, creds.client_secret);
      }
    });
    return () => clearTimers();
  }, [connect, clearTimers]);

  return {
    state,
    teams,
    channels,
    selectedTeam,
    selectedChannel,
    peakLevel,
    duration,
    savedPaths,
    error,
    connecting,
    connect,
    disconnect,
    selectTeam,
    setSelectedChannel,
    startRecording,
    stopRecording,
    reset,
  };
}
