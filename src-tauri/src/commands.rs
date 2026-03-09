use crate::audio::capture::AudioCapture;
use crate::audio::encoder::AudioFormat;
use crate::teams::bot::{TeamsBot, TeamInfo, ChannelInfo, TeamsCredentials};
use crate::settings::SettingsState;
use chrono::Local;
use parking_lot::Mutex;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Mutex as TokioMutex;

pub struct RecorderState(pub Mutex<AudioCapture>);
pub struct TeamsState(pub TokioMutex<TeamsBot>);

#[derive(Serialize, Clone)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub peak_level: f32,
}

#[derive(Serialize, Clone)]
pub struct TeamsStatus {
    pub connected: bool,
}

#[tauri::command]
pub fn start_recording(
    state: State<'_, RecorderState>,
    settings: State<'_, SettingsState>,
    format: Option<AudioFormat>,
) -> Result<String, String> {
    let mut recorder = state.0.lock();
    let fmt = format.unwrap_or(AudioFormat::Wav);

    let recordings_dir = crate::settings::recordings_dir(&settings);
    let s = settings.0.lock();
    let silence_trim = s.silence_trim;
    let max_duration_secs = s.max_duration_secs;
    drop(s);

    let timestamp = Local::now().format("%Y-%m-%d_%H%M%S");
    let filename = format!("teams-{}.{}", timestamp, fmt.extension());
    let output_path = recordings_dir.join(&filename);
    let path_str = output_path.to_string_lossy().to_string();

    recorder
        .start(&path_str, fmt, silence_trim, max_duration_secs)
        .map_err(|e| e.to_string())?;
    Ok(path_str)
}

#[tauri::command]
pub fn stop_recording(
    app: AppHandle,
    state: State<'_, RecorderState>,
) -> Result<Option<String>, String> {
    let mut recorder = state.0.lock();
    let result = recorder.stop().map_err(|e| e.to_string())?;

    // Send desktop notification on successful save
    if let Some(ref path) = result {
        let filename = path.rsplit(['/', '\\']).next().unwrap_or(path);
        let _ = app
            .notification()
            .builder()
            .title("Recording saved")
            .body(filename)
            .show();
    }

    Ok(result)
}

#[tauri::command]
pub fn get_status(state: State<'_, RecorderState>) -> RecordingStatus {
    let recorder = state.0.lock();
    RecordingStatus {
        is_recording: recorder.is_recording(),
        peak_level: recorder.peak_level(),
    }
}

#[tauri::command]
pub fn get_recordings_dir(settings: State<'_, SettingsState>) -> String {
    crate::settings::recordings_dir(&settings)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let file_path = std::path::Path::new(&path);
    let folder = file_path.parent().unwrap_or(file_path);

    if !folder.exists() {
        return Err(format!("Folder does not exist: {}", folder.display()));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(folder.as_os_str())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(folder.as_os_str())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(folder.as_os_str())
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

// --- Recording history commands ---

#[derive(Serialize, Clone)]
pub struct RecordingInfo {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub modified: String,
    pub format: String,
}

#[tauri::command]
pub fn list_recordings(settings: State<'_, SettingsState>) -> Result<Vec<RecordingInfo>, String> {
    let dir = crate::settings::recordings_dir(&settings);

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut recordings = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !matches!(ext.as_str(), "wav" | "flac" | "mp3") {
            continue;
        }

        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_default();

        recordings.push(RecordingInfo {
            path: path.to_string_lossy().to_string(),
            filename: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            size: metadata.len(),
            modified,
            format: ext,
        });
    }

    // Sort newest first
    recordings.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(recordings)
}

#[tauri::command]
pub fn delete_recording(settings: State<'_, SettingsState>, path: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    // Security: ensure the file is inside the recordings directory
    let recordings_dir = crate::settings::recordings_dir(&settings);

    let canonical_file = file_path
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;
    let canonical_dir = recordings_dir
        .canonicalize()
        .map_err(|e| format!("Recordings dir not found: {}", e))?;

    if !canonical_file.starts_with(&canonical_dir) {
        return Err("Cannot delete files outside the recordings directory".to_string());
    }

    std::fs::remove_file(file_path).map_err(|e| format!("Failed to delete: {}", e))
}

// --- Teams bot commands ---

#[tauri::command]
pub async fn teams_connect(
    state: State<'_, TeamsState>,
    client_id: String,
    tenant_id: String,
    client_secret: String,
) -> Result<(), String> {
    let mut bot = state.0.lock().await;
    bot.connect(&client_id, &tenant_id, &client_secret)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn teams_disconnect(state: State<'_, TeamsState>) -> Result<(), String> {
    let mut bot = state.0.lock().await;
    bot.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn teams_list_teams(state: State<'_, TeamsState>) -> Result<Vec<TeamInfo>, String> {
    let bot = state.0.lock().await;
    bot.list_teams().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn teams_list_channels(
    state: State<'_, TeamsState>,
    team_id: String,
) -> Result<Vec<ChannelInfo>, String> {
    let bot = state.0.lock().await;
    bot.list_channels(&team_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn teams_get_status(state: State<'_, TeamsState>) -> Result<TeamsStatus, String> {
    let bot = state.0.lock().await;
    Ok(TeamsStatus {
        connected: bot.is_connected(),
    })
}

#[tauri::command]
pub fn save_teams_credentials(
    client_id: String,
    tenant_id: String,
    client_secret: String,
) -> Result<(), String> {
    let creds = TeamsCredentials {
        client_id,
        tenant_id,
        client_secret,
    };
    crate::teams::bot::save_credentials(&creds).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_teams_credentials() -> Result<Option<TeamsCredentials>, String> {
    crate::teams::bot::load_credentials().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_teams_credentials() -> Result<(), String> {
    crate::teams::bot::delete_credentials().map_err(|e| e.to_string())
}

// --- Silence trim commands ---

#[tauri::command]
pub fn get_silence_trim(settings: State<'_, SettingsState>) -> bool {
    settings.0.lock().silence_trim
}

#[tauri::command]
pub fn set_silence_trim(settings: State<'_, SettingsState>, enabled: bool) -> bool {
    {
        let mut s = settings.0.lock();
        s.silence_trim = enabled;
    }
    settings.save();
    enabled
}

// --- Max duration commands ---

#[tauri::command]
pub fn get_max_duration(settings: State<'_, SettingsState>) -> Option<u32> {
    settings.0.lock().max_duration_secs
}

#[tauri::command]
pub fn set_max_duration(settings: State<'_, SettingsState>, seconds: Option<u32>) -> Option<u32> {
    {
        let mut s = settings.0.lock();
        s.max_duration_secs = seconds;
    }
    settings.save();
    seconds
}

// --- Shortcuts commands ---

#[tauri::command]
pub fn get_shortcuts(settings: State<'_, SettingsState>) -> crate::settings::ShortcutConfig {
    settings.0.lock().shortcuts.clone()
}

#[tauri::command]
pub fn set_shortcuts(
    settings: State<'_, SettingsState>,
    record: String,
    stop: String,
) -> crate::settings::ShortcutConfig {
    let config = crate::settings::ShortcutConfig { record, stop };
    {
        let mut s = settings.0.lock();
        s.shortcuts = config.clone();
    }
    settings.save();
    settings.0.lock().shortcuts.clone()
}

// --- Notify on record commands ---

#[tauri::command]
pub fn get_notify_on_record(settings: State<'_, SettingsState>) -> bool {
    settings.0.lock().notify_on_record
}

#[tauri::command]
pub fn set_notify_on_record(settings: State<'_, SettingsState>, enabled: bool) -> bool {
    {
        let mut s = settings.0.lock();
        s.notify_on_record = enabled;
    }
    settings.save();
    enabled
}

// --- Output directory commands ---

#[derive(Serialize, Clone)]
pub struct OutputDirInfo {
    pub path: String,
    pub is_custom: bool,
}

#[tauri::command]
pub fn get_output_dir(settings: State<'_, SettingsState>) -> OutputDirInfo {
    let s = settings.0.lock();
    let is_custom = s.output_dir.as_ref().is_some_and(|d| !d.is_empty());
    drop(s);
    OutputDirInfo {
        path: crate::settings::recordings_dir(&settings)
            .to_string_lossy()
            .to_string(),
        is_custom,
    }
}

#[tauri::command]
pub fn set_output_dir(
    settings: State<'_, SettingsState>,
    path: Option<String>,
) -> Result<OutputDirInfo, String> {
    // Validate the path if provided
    if let Some(ref p) = path {
        if !p.is_empty() {
            let dir = std::path::Path::new(p);
            if !dir.exists() {
                std::fs::create_dir_all(dir)
                    .map_err(|e| format!("Cannot create directory: {}", e))?;
            }
            if !dir.is_dir() {
                return Err("Path is not a directory".to_string());
            }
        }
    }

    {
        let mut s = settings.0.lock();
        s.output_dir = path;
    }
    settings.save();

    Ok(get_output_dir(settings))
}
