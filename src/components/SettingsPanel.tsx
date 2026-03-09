import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { X, Check, Loader2, Sun, Moon, FolderOpen, RotateCcw, VolumeX, Timer, Bell, Zap } from "lucide-react";
import { useUpdater } from "../hooks/useUpdater";
import { FormatSelector, type AudioFormat } from "./FormatSelector";
import { TeamsPanel } from "./TeamsPanel";
import { RecordingHistory } from "./RecordingHistory";
import { cn } from "../lib/utils";

interface TeamInfo {
  id: string;
  name: string;
}

interface ChannelInfo {
  id: string;
  name: string;
  team_id: string;
}

interface SettingsPanelProps {
  format: AudioFormat;
  onFormatChange: (format: AudioFormat) => void;
  onClose: () => void;
  teamsConnected: boolean;
  teamsConnecting: boolean;
  teams: TeamInfo[];
  channels: ChannelInfo[];
  selectedTeam: string | null;
  selectedChannel: string | null;
  onTeamsConnect: (clientId: string, tenantId: string, clientSecret: string) => void;
  onTeamsDisconnect: () => void;
  onSelectTeam: (teamId: string) => void;
  onSelectChannel: (channelId: string) => void;
  autoRecord: boolean;
  onAutoRecordChange: (enabled: boolean) => void;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
}

/* ── Reusable toggle switch ─────────────────────────────────── */
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer",
        enabled ? "bg-success" : "bg-border"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
          enabled && "translate-x-4"
        )}
      />
    </button>
  );
}

/* ── Setting row ─────────────────────────────────────────────── */
function SettingRow({
  icon: Icon,
  iconColor,
  label,
  description,
  children,
}: {
  icon: React.ElementType;
  iconColor?: string;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <Icon className={cn("w-4 h-4 shrink-0", iconColor ?? "text-text-muted/50")} />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text-primary leading-snug">{label}</p>
          {description && (
            <p className="text-[11px] text-text-muted/60 leading-snug mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ── Section wrapper ─────────────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-muted/40 px-1 mb-2">
        {title}
      </h3>
      <div className="rounded-2xl bg-bg-card border border-border/40 px-5 divide-y divide-border/30">
        {children}
      </div>
    </div>
  );
}

export function SettingsPanel({
  format,
  onFormatChange,
  onClose,
  teamsConnected,
  teamsConnecting,
  teams,
  channels,
  selectedTeam,
  selectedChannel,
  onTeamsConnect,
  onTeamsDisconnect,
  onSelectTeam,
  onSelectChannel,
  autoRecord,
  onAutoRecordChange,
  theme,
  onThemeChange,
}: SettingsPanelProps) {
  const updater = useUpdater();
  const [outputDir, setOutputDir] = useState("");
  const [isCustomDir, setIsCustomDir] = useState(false);
  const [silenceTrim, setSilenceTrim] = useState(false);
  const [maxDuration, setMaxDuration] = useState<number | null>(null);
  const [recordKey, setRecordKey] = useState("ctrl+r");
  const [stopKey, setStopKey] = useState("ctrl+s");
  const [capturingKey, setCapturingKey] = useState<"record" | "stop" | null>(null);
  const [notifyOnRecord, setNotifyOnRecord] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<{ path: string; is_custom: boolean }>("get_output_dir").then((info) => {
      if (!cancelled) {
        setOutputDir(info.path);
        setIsCustomDir(info.is_custom);
      }
    }).catch(() => {});
    invoke<boolean>("get_silence_trim").then((val) => {
      if (!cancelled) setSilenceTrim(val);
    }).catch(() => {});
    invoke<number | null>("get_max_duration").then((val) => {
      if (!cancelled) setMaxDuration(val);
    }).catch(() => {});
    invoke<{ record: string; stop: string }>("get_shortcuts").then((s) => {
      if (!cancelled) { setRecordKey(s.record); setStopKey(s.stop); }
    }).catch(() => {});
    invoke<boolean>("get_notify_on_record").then((val) => {
      if (!cancelled) setNotifyOnRecord(val);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleBrowseDir = async () => {
    const selected = await open({ directory: true, title: "Choose recordings folder" });
    if (selected) {
      try {
        const info = await invoke<{ path: string; is_custom: boolean }>("set_output_dir", { path: selected });
        setOutputDir(info.path);
        setIsCustomDir(info.is_custom);
      } catch { /* ignore */ }
    }
  };

  const handleSilenceTrim = async (enabled: boolean) => {
    try {
      const val = await invoke<boolean>("set_silence_trim", { enabled });
      setSilenceTrim(val);
    } catch { /* ignore */ }
  };

  const handleResetDir = async () => {
    try {
      const info = await invoke<{ path: string; is_custom: boolean }>("set_output_dir", { path: null });
      setOutputDir(info.path);
      setIsCustomDir(info.is_custom);
    } catch { /* ignore */ }
  };

  const handleMaxDuration = async (seconds: number | null) => {
    try {
      const val = await invoke<number | null>("set_max_duration", { seconds });
      setMaxDuration(val);
    } catch { /* ignore */ }
  };

  const handleKeyCapture = (target: "record" | "stop") => {
    setCapturingKey(target);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") { setCapturingKey(null); window.removeEventListener("keydown", handler); return; }
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("ctrl");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      const key = e.key.toLowerCase();
      if (!["control", "shift", "alt", "meta"].includes(key)) parts.push(key);
      if (parts.length > 0 && parts[parts.length - 1] !== "ctrl" && parts[parts.length - 1] !== "shift" && parts[parts.length - 1] !== "alt") {
        const combo = parts.join("+");
        const newRecord = target === "record" ? combo : recordKey;
        const newStop = target === "stop" ? combo : stopKey;
        invoke("set_shortcuts", { record: newRecord, stop: newStop }).catch(() => {});
        if (target === "record") setRecordKey(combo); else setStopKey(combo);
        setCapturingKey(null);
      }
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("keydown", handler);
  };

  const handleNotifyOnRecord = async (enabled: boolean) => {
    try {
      const val = await invoke<boolean>("set_notify_on_record", { enabled });
      setNotifyOnRecord(val);
    } catch { /* ignore */ }
  };

  const durationOptions: { label: string; value: number | null }[] = [
    { label: "No limit", value: null },
    { label: "5 min", value: 300 },
    { label: "15 min", value: 900 },
    { label: "30 min", value: 1800 },
    { label: "1 hour", value: 3600 },
    { label: "2 hours", value: 7200 },
  ];

  const updateLabel =
    updater.status === "up-to-date" ? "Up to date" :
    updater.status === "available" ? `v${updater.version} available` :
    updater.status === "checking" ? "Checking…" :
    updater.status === "downloading" ? `Updating ${(updater.progress / 1024 / 1024).toFixed(1)} MB` :
    updater.status === "ready" ? "Restarting…" :
    updater.status === "error" ? "Update failed" :
    "Check for updates";

  return (
    <div className="absolute inset-0 bg-bg-primary/97 backdrop-blur-md z-50 flex flex-col animate-fade-in">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <h2 className="text-sm font-semibold text-text-primary tracking-tight">Settings</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
            className="p-2 rounded-xl hover:bg-bg-elevated text-text-muted/40 hover:text-text-primary transition-all cursor-pointer"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-bg-elevated text-text-muted/40 hover:text-text-primary transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Scrollable content ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* ── Teams ─────────────────────────────────────────── */}
        <Section title="Microsoft Teams">
          <div className="py-4">
            <TeamsPanel
              connected={teamsConnected}
              connecting={teamsConnecting}
              teams={teams}
              channels={channels}
              selectedTeam={selectedTeam}
              selectedChannel={selectedChannel}
              onConnect={onTeamsConnect}
              onDisconnect={onTeamsDisconnect}
              onSelectTeam={onSelectTeam}
              onSelectChannel={onSelectChannel}
            />
          </div>

          {teamsConnected && (
            <SettingRow icon={Bell} iconColor={notifyOnRecord ? "text-success" : undefined} label="Notify channel" description="Post a message when recording starts">
              <Toggle enabled={notifyOnRecord} onChange={handleNotifyOnRecord} />
            </SettingRow>
          )}

          {teamsConnected && selectedChannel && (
            <SettingRow icon={Zap} iconColor={autoRecord ? "text-success" : undefined} label="Auto-record" description="Start when a meeting begins">
              <Toggle enabled={autoRecord} onChange={onAutoRecordChange} />
            </SettingRow>
          )}
        </Section>

        {/* ── Recording ───────────────────────────────────── */}
        <Section title="Recording">
          {/* Format */}
          <div className="py-4">
            <p className="text-[13px] font-medium text-text-primary mb-3">Format</p>
            <FormatSelector value={format} onChange={onFormatChange} />
          </div>

          {/* Output directory */}
          <div className="py-4">
            <p className="text-[13px] font-medium text-text-primary mb-2">Output folder</p>
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-text-muted/40 shrink-0" />
              <p className="text-[11px] text-text-muted/60 truncate flex-1" title={outputDir}>
                {outputDir || "Loading…"}
              </p>
              {isCustomDir && (
                <button
                  onClick={handleResetDir}
                  className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted/40 hover:text-text-primary transition-all cursor-pointer"
                  title="Reset to default"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleBrowseDir}
                className="px-3 py-1.5 rounded-lg bg-bg-primary border border-border/50 text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-all cursor-pointer shrink-0"
              >
                Browse…
              </button>
            </div>
          </div>

          {/* Silence trim */}
          <SettingRow icon={VolumeX} iconColor={silenceTrim ? "text-success" : undefined} label="Trim silence" description="Strip leading & trailing silence">
            <Toggle enabled={silenceTrim} onChange={handleSilenceTrim} />
          </SettingRow>

          {/* Max duration */}
          <SettingRow icon={Timer} label="Max duration" description="Auto-stop after limit">
            <select
              value={maxDuration ?? ""}
              onChange={(e) => handleMaxDuration(e.target.value ? Number(e.target.value) : null)}
              className="text-[11px] bg-bg-primary border border-border/50 rounded-lg px-3 py-1.5 text-text-secondary cursor-pointer outline-none hover:border-border transition-colors"
            >
              {durationOptions.map((opt) => (
                <option key={opt.label} value={opt.value ?? ""}>{opt.label}</option>
              ))}
            </select>
          </SettingRow>
        </Section>

        {/* ── Shortcuts ───────────────────────────────────── */}
        <Section title="Shortcuts">
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px] text-text-primary">Record</span>
            <button
              onClick={() => handleKeyCapture("record")}
              className={cn(
                "text-[11px] font-mono px-3 py-1 rounded-lg border transition-all cursor-pointer",
                capturingKey === "record"
                  ? "border-accent bg-accent/10 text-accent animate-pulse"
                  : "border-border/50 bg-bg-primary text-text-muted/70 hover:border-accent/50"
              )}
            >
              {capturingKey === "record" ? "Press key…" : recordKey}
            </button>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px] text-text-primary">Stop</span>
            <button
              onClick={() => handleKeyCapture("stop")}
              className={cn(
                "text-[11px] font-mono px-3 py-1 rounded-lg border transition-all cursor-pointer",
                capturingKey === "stop"
                  ? "border-accent bg-accent/10 text-accent animate-pulse"
                  : "border-border/50 bg-bg-primary text-text-muted/70 hover:border-accent/50"
              )}
            >
              {capturingKey === "stop" ? "Press key…" : stopKey}
            </button>
          </div>
        </Section>

        {/* ── History ─────────────────────────────────────── */}
        <Section title="History">
          <div className="py-4">
            <RecordingHistory />
          </div>
        </Section>
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="px-6 py-3 border-t border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <p className="text-[11px] text-text-muted/30 font-medium tracking-wide">
            TeamRec v1.0.0
          </p>
          <span className="text-text-muted/15">·</span>
          <button
            onClick={
              updater.status === "available" ? updater.installUpdate :
              (updater.status === "idle" || updater.status === "up-to-date" || updater.status === "error")
                ? updater.checkForUpdates : undefined
            }
            disabled={updater.status === "checking" || updater.status === "downloading" || updater.status === "ready"}
            className="text-[11px] text-text-muted/30 hover:text-text-muted/60 transition-colors cursor-pointer disabled:cursor-default flex items-center gap-1.5"
          >
            {updater.status === "checking" && <Loader2 className="w-3 h-3 animate-spin" />}
            {updater.status === "up-to-date" && <Check className="w-3 h-3 text-success/50" />}
            {updateLabel}
          </button>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] text-text-muted/25">
          <kbd className="font-mono px-1.5 py-0.5 rounded-md bg-bg-primary/50 border border-border/30">{recordKey}</kbd>
          <span>rec</span>
          <kbd className="font-mono px-1.5 py-0.5 rounded-md bg-bg-primary/50 border border-border/30">Esc</kbd>
        </div>
      </div>
    </div>
  );
}
