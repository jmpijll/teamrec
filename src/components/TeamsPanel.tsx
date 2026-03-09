import { useState } from "react";
import { Plug, Unplug, Loader2, ChevronDown, CheckCircle2 } from "lucide-react";
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

interface TeamsPanelProps {
  connected: boolean;
  connecting: boolean;
  teams: TeamInfo[];
  channels: ChannelInfo[];
  selectedTeam: string | null;
  selectedChannel: string | null;
  onConnect: (clientId: string, tenantId: string, clientSecret: string) => void;
  onDisconnect: () => void;
  onSelectTeam: (teamId: string) => void;
  onSelectChannel: (channelId: string) => void;
}

export function TeamsPanel({
  connected,
  connecting,
  teams,
  channels,
  selectedTeam,
  selectedChannel,
  onConnect,
  onDisconnect,
  onSelectTeam,
  onSelectChannel,
}: TeamsPanelProps) {
  const [clientId, setClientId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const handleConnect = () => {
    if (clientId.trim() && tenantId.trim() && clientSecret.trim()) {
      onConnect(clientId.trim(), tenantId.trim(), clientSecret.trim());
      setClientId("");
      setTenantId("");
      setClientSecret("");
    }
  };

  if (!connected) {
    return (
      <div className="flex flex-col gap-3.5 w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-text-muted/30" />
          <p className="text-[13px] text-text-muted/70">Not connected</p>
        </div>
        <input
          type="text"
          placeholder="Client ID (Azure AD App)"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl bg-bg-primary border border-border/60 text-[13px] text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 transition-colors"
        />
        <input
          type="text"
          placeholder="Tenant ID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl bg-bg-primary border border-border/60 text-[13px] text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 transition-colors"
        />
        <input
          type="password"
          placeholder="Client Secret"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          className="w-full px-3.5 py-2.5 rounded-xl bg-bg-primary border border-border/60 text-[13px] text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 transition-colors"
        />
        <button
          onClick={handleConnect}
          disabled={!clientId.trim() || !tenantId.trim() || !clientSecret.trim() || connecting}
          className={cn(
            "flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all cursor-pointer",
            "bg-accent/90 text-white hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          {connecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plug className="w-4 h-4" />
          )}
          {connecting ? "Connecting..." : "Connect to Teams"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Connection status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <p className="text-[13px] text-success font-medium">Connected</p>
        </div>
        <button
          onClick={onDisconnect}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-text-muted/50 hover:text-record hover:bg-record/8 transition-colors cursor-pointer"
        >
          <Unplug className="w-3.5 h-3.5" />
          Disconnect
        </button>
      </div>

      {/* Team selector */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-text-muted/60 uppercase tracking-wider">
          Team
        </label>
        <div className="relative">
          <select
            value={selectedTeam ?? ""}
            onChange={(e) => onSelectTeam(e.target.value)}
            className="w-full px-3.5 py-2.5 pr-8 rounded-xl bg-bg-primary border border-border/60 text-[13px] text-text-primary focus:outline-none focus:border-accent/50 appearance-none cursor-pointer transition-colors"
          >
            <option value="" disabled>
              Select team...
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted/30 pointer-events-none" />
        </div>
      </div>

      {/* Channel selector */}
      {selectedTeam && (
        <div className="space-y-2 animate-fade-in">
          <label className="text-[11px] font-medium text-text-muted/60 uppercase tracking-wider">
            Channel
          </label>
          <div className="relative">
            <select
              value={selectedChannel ?? ""}
              onChange={(e) => onSelectChannel(e.target.value)}
              className="w-full px-3.5 py-2.5 pr-8 rounded-xl bg-bg-primary border border-border/60 text-[13px] text-text-primary focus:outline-none focus:border-accent/50 appearance-none cursor-pointer transition-colors"
            >
              <option value="" disabled>
                Select channel...
              </option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  # {ch.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted/30 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Ready indicator */}
      {selectedChannel && (
        <div className="flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-success" />
          <p className="text-[13px] text-success/80">Ready to record</p>
        </div>
      )}
    </div>
  );
}
