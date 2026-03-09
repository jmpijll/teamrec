# TeamRec

Beautiful, minimal Microsoft Teams audio recorder — a desktop app built with [Tauri v2](https://v2.tauri.app), React, and Rust.

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6264A7)](https://github.com/jmpijll/teamrec)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## Features

- **One-click recording** — Record Microsoft Teams audio output with a single button press
- **Per-process capture** — On Windows, captures _only_ Teams audio via WASAPI loopback (no other system sounds)
- **Multiple formats** — WAV (lossless), FLAC (lossless compressed), MP3 (lossy, smallest)
- **Silence trimming** — Optionally strip leading & trailing silence
- **Auto-stop** — Configurable max recording duration
- **Teams integration** — Connect via Microsoft Graph API to browse teams and channels
- **Keyboard shortcuts** — Configurable record/stop hotkeys
- **System tray** — Minimize to tray, record from tray menu
- **Recording history** — Browse, open, and delete past recordings
- **Dark & light themes** — Toggle between Teams dark and light themes
- **Auto-updates** — Built-in updater via GitHub releases
- **Cross-platform** — Windows (WASAPI), Linux (PulseAudio/PipeWire per-app routing), macOS (BlackHole/virtual audio)
- **Runs alongside DiscRec** — Unique app identifiers, ports, and config directories

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [pnpm](https://pnpm.io/) ≥ 9
- [Rust](https://www.rust-lang.org/tools/install) ≥ 1.77
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

### Platform-specific

| Platform | Audio capture method |
|----------|---------------------|
| **Windows** | WASAPI per-process loopback — captures only `ms-teams.exe` / `Teams.exe` audio |
| **Linux** | PulseAudio/PipeWire per-app routing via `pactl` — creates a null sink and moves Teams' stream |
| **macOS** | Requires a virtual audio device like [BlackHole](https://existential.audio/blackhole/) |

## Getting Started

```bash
# Clone
git clone https://github.com/jmpijll/teamrec.git
cd teamrec

# Install frontend dependencies
pnpm install

# Run in development mode
pnpm tauri:dev

# Build for production
pnpm tauri:build
```

## Teams Integration (Optional)

To browse teams and channels from the app, you need an Azure AD app registration:

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Create a new registration
3. Add API permissions: `Team.ReadBasic.All`, `Channel.ReadBasic.All` (Application type)
4. Create a client secret
5. Enter the **Client ID**, **Tenant ID**, and **Client Secret** in TeamRec settings

> **Note:** The Teams integration is optional. You can use TeamRec in "Local" mode to capture Teams audio without any API credentials — it uses per-process audio capture directly.

## Coexistence with DiscRec

TeamRec is designed to run alongside [DiscRec](https://github.com/jmpijll/discrec) without conflicts:

| Resource | DiscRec | TeamRec |
|----------|---------|---------|
| App identifier | `com.discrec.app` | `com.teamrec.app` |
| Dev server port | 5173 | 5175 |
| Config directory | `~/.config/DiscRec` | `~/.config/TeamRec` |
| Recordings directory | `~/Music/DiscRec` | `~/Music/TeamRec` |
| Keyring service | `com.discrec.app` | `com.teamrec.app` |
| PulseAudio sink | `discrec_capture` | `teamrec_capture` |

## Project Structure

```
teamrec/
├── src/                    # React frontend (Segoe UI, Teams purple theme)
│   ├── App.tsx             # Main application component
│   ├── main.tsx            # React entry point
│   ├── index.css           # Tailwind + Microsoft Teams theme styles
│   ├── components/         # UI components
│   │   ├── AudioMeter.tsx
│   │   ├── CompletedView.tsx
│   │   ├── FormatSelector.tsx
│   │   ├── RecordButton.tsx
│   │   ├── RecordingHistory.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── StatusBar.tsx
│   │   └── TeamsPanel.tsx
│   ├── hooks/              # React hooks
│   │   ├── useRecorder.ts
│   │   ├── useTeams.ts
│   │   ├── useKeyboardShortcuts.ts
│   │   └── useUpdater.ts
│   └── lib/
│       └── utils.ts
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs          # Tauri app setup, plugins, tray
│   │   ├── commands.rs     # Tauri IPC commands
│   │   ├── settings.rs     # App settings persistence
│   │   ├── audio/
│   │   │   ├── mod.rs
│   │   │   ├── capture.rs  # Per-process audio capture (WASAPI/PulseAudio)
│   │   │   └── encoder.rs  # WAV/FLAC/MP3 encoding + silence trimming
│   │   └── teams/
│   │       ├── mod.rs
│   │       └── bot.rs      # Microsoft Graph API client, OAuth2, keyring
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
│       └── default.json
├── package.json
├── vite.config.ts
└── index.html
```

## License

MIT
