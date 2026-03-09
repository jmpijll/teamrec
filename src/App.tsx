import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecorder } from "./hooks/useRecorder";
import { useTeams } from "./hooks/useTeams";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { AudioMeter } from "./components/AudioMeter";
import { RecordButton } from "./components/RecordButton";
import { StatusBar } from "./components/StatusBar";
import { CompletedView } from "./components/CompletedView";
import { SettingsPanel } from "./components/SettingsPanel";
import type { AudioFormat } from "./components/FormatSelector";
import { Settings } from "lucide-react";
import { cn } from "./lib/utils";

type RecordMode = "local" | "teams";

export default function App() {
  const recorder = useRecorder();
  const teams = useTeams();

  const [showSettings, setShowSettings] = useState(false);
  const [autoRecord, setAutoRecord] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mode, setMode] = useState<RecordMode>("local");

  // Apply theme to root element
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Determine current recording state across modes
  const isRecording =
    mode === "local"
      ? recorder.state === "recording"
      : teams.state === "recording";

  const isDone =
    mode === "local"
      ? recorder.state === "done"
      : teams.state === "done";

  const peakLevel =
    mode === "local" ? recorder.peakLevel : teams.peakLevel;

  const duration =
    mode === "local" ? recorder.duration : teams.duration;

  const error =
    mode === "local" ? recorder.error : teams.error;

  // Can record: local always, teams needs channel selected
  const canRecord =
    mode === "local" ? true : teams.state === "connected" && !!teams.selectedChannel;

  const handleRecord = useCallback(() => {
    if (mode === "local") {
      recorder.startRecording();
    } else {
      teams.startRecording(recorder.format);
    }
  }, [mode, recorder, teams]);

  const handleStop = useCallback(() => {
    if (mode === "local") {
      recorder.stopRecording();
    } else {
      teams.stopRecording();
    }
  }, [mode, recorder, teams]);

  const handleReset = useCallback(() => {
    if (mode === "local") {
      recorder.reset();
    } else {
      teams.reset();
    }
  }, [mode, recorder, teams]);

  const handleFormatChange = useCallback(
    (fmt: AudioFormat) => {
      recorder.setFormat(fmt);
    },
    [recorder]
  );

  // Load shortcuts from settings
  const [shortcuts, setShortcuts] = useState({ record: "ctrl+r", stop: "ctrl+s" });
  useEffect(() => {
    invoke<{ record: string; stop: string }>("get_shortcuts")
      .then(setShortcuts)
      .catch(() => {});
  }, []);

  useKeyboardShortcuts({
    onRecord: handleRecord,
    onStop: handleStop,
    isRecording,
    canRecord: canRecord && !isDone,
    disabled: showSettings,
    shortcuts,
  });

  // Auto-switch to teams mode when connected
  useEffect(() => {
    if (teams.state !== "disconnected") {
      setMode("teams");
    }
  }, [teams.state]);

  const filePath =
    mode === "local"
      ? recorder.filePath
      : teams.savedPaths.length > 0
        ? teams.savedPaths[0]
        : null;

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-bg-primary p-6 gap-6">
      {/* Settings gear */}
      <button
        onClick={() => setShowSettings(true)}
        className="absolute top-4 right-4 p-2.5 rounded-xl text-text-muted/30 hover:text-text-primary hover:bg-bg-elevated transition-all cursor-pointer z-10"
      >
        <Settings className="w-5 h-5" />
      </button>

      {/* Mode indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <button
          onClick={() => setMode("local")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer",
            mode === "local"
              ? "bg-accent text-white"
              : "text-text-muted/40 hover:text-text-muted"
          )}
        >
          Local
        </button>
        <button
          onClick={() => setMode("teams")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer",
            mode === "teams"
              ? "bg-accent text-white"
              : "text-text-muted/40 hover:text-text-muted"
          )}
        >
          Teams
        </button>
      </div>

      {/* Main content */}
      {isDone ? (
        <CompletedView
          filePath={filePath}
          duration={duration}
          onReset={handleReset}
        />
      ) : (
        <>
          {/* Audio meter */}
          <AudioMeter level={peakLevel} isActive={isRecording} />

          {/* Record button */}
          <RecordButton
            isRecording={isRecording}
            onClick={isRecording ? handleStop : handleRecord}
            disabled={!canRecord}
          />

          {/* Status bar */}
          <StatusBar isRecording={isRecording} duration={duration} />

          {/* Idle hint */}
          {!isRecording && (
            <p className="text-[12px] text-text-muted/40 animate-fade-in">
              {mode === "teams" && !teams.selectedChannel
                ? "Connect to Teams in Settings to record meetings"
                : "Click to start recording Teams audio"}
            </p>
          )}
        </>
      )}

      {/* Error display */}
      {error && (
        <div className="absolute bottom-4 left-4 right-4 px-4 py-3 rounded-xl bg-record/10 border border-record/20 text-[12px] text-record animate-fade-in">
          {error}
        </div>
      )}

      {/* Settings panel overlay */}
      {showSettings && (
        <SettingsPanel
          format={recorder.format}
          onFormatChange={handleFormatChange}
          onClose={() => setShowSettings(false)}
          teamsConnected={teams.state !== "disconnected"}
          teamsConnecting={teams.connecting}
          teams={teams.teams}
          channels={teams.channels}
          selectedTeam={teams.selectedTeam}
          selectedChannel={teams.selectedChannel}
          onTeamsConnect={teams.connect}
          onTeamsDisconnect={teams.disconnect}
          onSelectTeam={teams.selectTeam}
          onSelectChannel={teams.setSelectedChannel}
          autoRecord={autoRecord}
          onAutoRecordChange={setAutoRecord}
          theme={theme}
          onThemeChange={setTheme}
        />
      )}
    </div>
  );
}
