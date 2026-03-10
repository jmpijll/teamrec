use anyhow::Result;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use super::encoder::{create_encoder, AudioFormat};

enum StreamMsg {
    Stop,
}

pub struct AudioCapture {
    stop_tx: Option<mpsc::Sender<StreamMsg>>,
    thread_handle: Option<thread::JoinHandle<Result<Option<String>>>>,
    is_recording: Arc<AtomicBool>,
    peak_level_bits: Arc<AtomicU32>,
}

// SAFETY: The cpal::Stream lives entirely on the dedicated thread
// and is never moved across threads. Only Send+Sync atomics are shared.
unsafe impl Send for AudioCapture {}
unsafe impl Sync for AudioCapture {}

impl AudioCapture {
    pub fn new() -> Self {
        Self {
            stop_tx: None,
            thread_handle: None,
            is_recording: Arc::new(AtomicBool::new(false)),
            peak_level_bits: Arc::new(AtomicU32::new(0)),
        }
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::Relaxed)
    }

    pub fn peak_level(&self) -> f32 {
        f32::from_bits(self.peak_level_bits.load(Ordering::Relaxed))
    }

    pub fn start(
        &mut self,
        output_path: &str,
        format: AudioFormat,
        silence_trim: bool,
        max_duration_secs: Option<u32>,
    ) -> Result<()> {
        if self.is_recording() {
            anyhow::bail!("Already recording");
        }

        let (stop_tx, stop_rx) = mpsc::channel();
        let is_recording = Arc::clone(&self.is_recording);
        let peak_level_bits = Arc::clone(&self.peak_level_bits);
        let path = output_path.to_string();

        #[cfg(target_os = "windows")]
        let handle = {
            thread::spawn(move || -> Result<Option<String>> {
                capture_windows(
                    &path,
                    format,
                    silence_trim,
                    max_duration_secs,
                    &is_recording,
                    &peak_level_bits,
                    &stop_rx,
                )
            })
        };

        #[cfg(not(target_os = "windows"))]
        let handle = {
            thread::spawn(move || -> Result<Option<String>> {
                capture_cpal(
                    &path,
                    format,
                    silence_trim,
                    max_duration_secs,
                    &is_recording,
                    &peak_level_bits,
                    &stop_rx,
                )
            })
        };

        self.is_recording.store(true, Ordering::Relaxed);
        self.stop_tx = Some(stop_tx);
        self.thread_handle = Some(handle);

        Ok(())
    }

    pub fn stop(&mut self) -> Result<Option<String>> {
        self.is_recording.store(false, Ordering::Relaxed);
        self.peak_level_bits
            .store(0f32.to_bits(), Ordering::Relaxed);

        // Signal the recording thread to stop
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(StreamMsg::Stop);
        }

        // Wait for thread to finish and get the file path
        if let Some(handle) = self.thread_handle.take() {
            match handle.join() {
                Ok(result) => return result,
                Err(_) => anyhow::bail!("Recording thread panicked"),
            }
        }

        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// Windows: per-process audio capture via WASAPI (captures only Teams audio)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn find_teams_pid() -> Result<u32> {
    use std::ffi::OsStr;
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let refreshes = RefreshKind::nothing().with_processes(ProcessRefreshKind::everything());
    let system = System::new_with_specifics(refreshes);

    // Microsoft Teams on Windows runs as ms-teams.exe (new Teams) or Teams.exe (classic)
    let teams_names = ["ms-teams.exe", "Teams.exe", "msteams.exe", "MSTeams.exe"];

    for name in &teams_names {
        let mut pids: Vec<_> = system.processes_by_name(OsStr::new(name)).collect();
        if !pids.is_empty() {
            // Use the parent PID if available (captures entire process tree)
            pids.sort_by_key(|p| p.pid());
            let process = pids[0];
            let pid = process.parent().unwrap_or(process.pid()).as_u32();
            log::info!(
                "Found {} with PID {} (tree root: {})",
                name,
                process.pid(),
                pid
            );
            return Ok(pid);
        }
    }

    anyhow::bail!("Microsoft Teams is not running. Please start Teams before recording.")
}

#[cfg(target_os = "windows")]
fn capture_windows(
    path: &str,
    format: AudioFormat,
    silence_trim: bool,
    max_duration_secs: Option<u32>,
    is_recording: &Arc<AtomicBool>,
    peak_level_bits: &Arc<AtomicU32>,
    stop_rx: &mpsc::Receiver<StreamMsg>,
) -> Result<Option<String>> {
    use std::collections::VecDeque;
    use std::time::Instant;
    use wasapi::*;

    let teams_pid = find_teams_pid()?;
    log::info!("Starting per-process capture for Teams PID {}", teams_pid);

    // Initialize COM for this thread
    let hr = initialize_mta();
    if hr.is_err() {
        anyhow::bail!("COM init failed: {:?}", hr);
    }

    let sample_rate = 48000u32;
    let channels = 2u16;
    let bits_per_sample = 32u32;

    let desired_format = WaveFormat::new(
        bits_per_sample as usize,
        bits_per_sample as usize,
        &SampleType::Float,
        sample_rate as usize,
        channels as usize,
        None,
    );
    let blockalign = desired_format.get_blockalign();

    let mut audio_client = AudioClient::new_application_loopback_client(teams_pid, true)
        .map_err(|e| anyhow::anyhow!("Failed to create loopback client for Teams: {:?}", e))?;

    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: 0,
    };
    audio_client
        .initialize_client(&desired_format, &Direction::Capture, &mode)
        .map_err(|e| anyhow::anyhow!("Failed to init WASAPI client: {:?}", e))?;

    let h_event = audio_client
        .set_get_eventhandle()
        .map_err(|e| anyhow::anyhow!("Failed to get event handle: {:?}", e))?;

    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| anyhow::anyhow!("Failed to get capture client: {:?}", e))?;

    let mut encoder = create_encoder(path, channels, sample_rate, format, silence_trim)?;

    audio_client
        .start_stream()
        .map_err(|e| anyhow::anyhow!("Failed to start stream: {:?}", e))?;

    log::info!("WASAPI per-process capture started: {}", path);

    let mut sample_queue: VecDeque<u8> = VecDeque::new();
    let bytes_per_frame = blockalign as usize;
    let start_time = Instant::now();

    loop {
        // Check for stop signal (non-blocking)
        if stop_rx.try_recv().is_ok() || !is_recording.load(Ordering::Relaxed) {
            break;
        }

        // Check max duration
        if let Some(max_secs) = max_duration_secs {
            if start_time.elapsed().as_secs() >= max_secs as u64 {
                log::info!("Max recording duration ({max_secs}s) reached, auto-stopping");
                is_recording.store(false, Ordering::Relaxed);
                break;
            }
        }

        // Wait for audio data (up to 200ms timeout)
        let _ = h_event.wait_for_event(200);

        // Read available packets
        loop {
            let next = capture_client
                .get_next_packet_size()
                .unwrap_or(Some(0))
                .unwrap_or(0);
            if next == 0 {
                break;
            }
            let additional = (next as usize * bytes_per_frame)
                .saturating_sub(sample_queue.capacity() - sample_queue.len());
            sample_queue.reserve(additional);
            if capture_client
                .read_from_device_to_deque(&mut sample_queue)
                .is_err()
            {
                break;
            }
        }

        // Process buffered samples as f32
        while sample_queue.len() >= 4 {
            let b = [
                sample_queue.pop_front().unwrap(),
                sample_queue.pop_front().unwrap(),
                sample_queue.pop_front().unwrap(),
                sample_queue.pop_front().unwrap(),
            ];
            let sample = f32::from_le_bytes(b);

            // Update peak level (per-sample for responsiveness)
            let current_peak = f32::from_bits(peak_level_bits.load(Ordering::Relaxed));
            let abs_sample = sample.abs();
            if abs_sample > current_peak {
                peak_level_bits.store(abs_sample.to_bits(), Ordering::Relaxed);
            }

            if let Err(e) = encoder.write_sample(sample) {
                log::error!("Failed to write sample: {}", e);
                break;
            }
        }

        // Decay peak level slightly each loop iteration
        let current = f32::from_bits(peak_level_bits.load(Ordering::Relaxed));
        if current > 0.001 {
            peak_level_bits.store((current * 0.95).to_bits(), Ordering::Relaxed);
        }
    }

    // Stop and finalize
    let _ = audio_client.stop_stream();
    let p = encoder.path().to_string();
    encoder.finalize()?;
    log::info!("Recording saved: {}", p);
    Ok(Some(p))
}

// ---------------------------------------------------------------------------
// Linux / macOS: cpal-based loopback capture (system audio)
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "windows"))]
fn capture_cpal(
    path: &str,
    format: AudioFormat,
    silence_trim: bool,
    max_duration_secs: Option<u32>,
    is_recording: &Arc<AtomicBool>,
    peak_level_bits: &Arc<AtomicU32>,
    stop_rx: &mpsc::Receiver<StreamMsg>,
) -> Result<Option<String>> {
    use super::encoder::AudioEncoder;
    use anyhow::Context;
    use cpal::traits::{DeviceTrait, StreamTrait};
    use cpal::{SampleFormat, StreamConfig};
    use parking_lot::Mutex;
    use std::time::{Duration, Instant};

    let host = cpal::default_host();

    // On Linux, try per-app Teams routing via PulseAudio/PipeWire
    #[cfg(target_os = "linux")]
    let _routing = pulse_routing::TeamsRouting::setup();

    #[cfg(target_os = "linux")]
    let preferred_source = _routing.as_ref().map(|r| r.monitor_source());

    #[cfg(not(target_os = "linux"))]
    let preferred_source: Option<&str> = None;

    let device = get_loopback_device(&host, preferred_source)?;
    let config = device
        .default_output_config()
        .context("Failed to get default output config")?;

    log::info!(
        "Recording from: {} (format: {:?}, rate: {}, channels: {})",
        device.name().unwrap_or_default(),
        config.sample_format(),
        config.sample_rate().0,
        config.channels()
    );

    let encoder = create_encoder(
        path,
        config.channels(),
        config.sample_rate().0,
        format,
        silence_trim,
    )?;
    let encoder: Arc<Mutex<Option<Box<dyn AudioEncoder>>>> = Arc::new(Mutex::new(Some(encoder)));

    let writer_ref = Arc::clone(&encoder);
    let rec_flag = Arc::clone(is_recording);
    let peak_bits = Arc::clone(peak_level_bits);
    let sample_format = config.sample_format();
    let stream_config: StreamConfig = config.into();

    let err_fn = |err: cpal::StreamError| {
        log::error!("Audio stream error: {}", err);
    };

    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !rec_flag.load(Ordering::Relaxed) {
                    return;
                }
                let peak = data.iter().fold(0.0f32, |max, &s| max.max(s.abs()));
                peak_bits.store(peak.to_bits(), Ordering::Relaxed);

                if let Some(ref mut w) = *writer_ref.lock() {
                    for &sample in data {
                        if let Err(e) = w.write_sample(sample) {
                            log::error!("Failed to write sample: {}", e);
                            return;
                        }
                    }
                }
            },
            err_fn,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                if !rec_flag.load(Ordering::Relaxed) {
                    return;
                }
                let peak = data.iter().fold(0.0f32, |max, &s| {
                    max.max((s as f32 / i16::MAX as f32).abs())
                });
                peak_bits.store(peak.to_bits(), Ordering::Relaxed);

                if let Some(ref mut w) = *writer_ref.lock() {
                    for &sample in data {
                        let float_sample = sample as f32 / i16::MAX as f32;
                        if let Err(e) = w.write_sample(float_sample) {
                            log::error!("Failed to write sample: {}", e);
                            return;
                        }
                    }
                }
            },
            err_fn,
            None,
        ),
        fmt => anyhow::bail!("Unsupported sample format: {:?}", fmt),
    }
    .context("Failed to build input stream")?;

    stream.play().context("Failed to start audio stream")?;
    log::info!("Recording started: {}", path);

    // Block until stop signal or max duration
    let start_time = Instant::now();
    loop {
        let timeout = Duration::from_secs(1);
        match stop_rx.recv_timeout(timeout) {
            Ok(_) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(max_secs) = max_duration_secs {
                    if start_time.elapsed().as_secs() >= max_secs as u64 {
                        log::info!("Max recording duration ({max_secs}s) reached, auto-stopping");
                        is_recording.store(false, Ordering::Relaxed);
                        break;
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    // Drop stream first to stop callbacks
    drop(stream);

    // Finalize the encoded file
    let result = if let Some(w) = encoder.lock().take() {
        let p = w.path().to_string();
        w.finalize()?;
        log::info!("Recording saved: {}", p);
        Some(p)
    } else {
        None
    };

    Ok(result)
}

// ---------------------------------------------------------------------------
// Linux: PulseAudio/PipeWire per-app routing for Teams-only capture
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
mod pulse_routing {
    use std::process::Command;

    pub struct TeamsRouting {
        null_sink_module: u32,
        loopback_module: u32,
        sink_input_idx: u32,
        original_sink: u32,
    }

    impl TeamsRouting {
        /// Try to set up per-app routing. Returns None if pactl or Teams not found.
        pub fn setup() -> Option<Self> {
            // Find Teams' sink input
            let (sink_input_idx, original_sink) = find_teams_sink_input()?;
            log::info!("Found Teams sink input #{sink_input_idx} on sink #{original_sink}");

            // Create null sink for capture
            let null_sink_module = run_pactl(&[
                "load-module",
                "module-null-sink",
                "sink_name=teamrec_capture",
                "sink_properties=device.description=TeamRec",
                "rate=48000",
                "channels=2",
            ])?;
            log::info!("Created null sink (module #{null_sink_module})");

            // Create loopback so user still hears Teams
            let loopback_module = run_pactl(&[
                "load-module",
                "module-loopback",
                "source=teamrec_capture.monitor",
                "latency_msec=1",
            ]);
            if loopback_module.is_none() {
                log::warn!("Failed to create loopback — user won't hear Teams during recording");
            }

            // Move Teams to our capture sink
            let moved = Command::new("pactl")
                .args([
                    "move-sink-input",
                    &sink_input_idx.to_string(),
                    "teamrec_capture",
                ])
                .output()
                .ok()
                .map(|o| o.status.success())
                .unwrap_or(false);

            if !moved {
                log::warn!("Failed to move Teams sink input — falling back to system capture");
                let _ = unload_module(null_sink_module);
                if let Some(lb) = loopback_module {
                    let _ = unload_module(lb);
                }
                return None;
            }

            log::info!("Teams audio routed to teamrec_capture sink");
            Some(Self {
                null_sink_module,
                loopback_module: loopback_module.unwrap_or(0),
                sink_input_idx,
                original_sink,
            })
        }

        pub fn monitor_source(&self) -> &str {
            "teamrec_capture.monitor"
        }
    }

    impl Drop for TeamsRouting {
        fn drop(&mut self) {
            // Move Teams back to original sink
            let _ = Command::new("pactl")
                .args([
                    "move-sink-input",
                    &self.sink_input_idx.to_string(),
                    &self.original_sink.to_string(),
                ])
                .output();
            log::info!("Restored Teams to original sink #{}", self.original_sink);

            if self.loopback_module != 0 {
                let _ = unload_module(self.loopback_module);
            }
            let _ = unload_module(self.null_sink_module);
            log::info!("Cleaned up PulseAudio modules");
        }
    }

    fn run_pactl(args: &[&str]) -> Option<u32> {
        let output = Command::new("pactl").args(args).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.trim().parse().ok()
    }

    fn unload_module(id: u32) -> bool {
        Command::new("pactl")
            .args(["unload-module", &id.to_string()])
            .output()
            .ok()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Parse `pactl list sink-inputs` to find Teams' sink input index and current sink.
    fn find_teams_sink_input() -> Option<(u32, u32)> {
        let output = Command::new("pactl")
            .args(["list", "sink-inputs"])
            .output()
            .ok()?;
        if !output.status.success() {
            log::warn!("pactl not available — cannot set up per-app capture");
            return None;
        }

        let text = String::from_utf8_lossy(&output.stdout);
        let mut current_idx: Option<u32> = None;
        let mut current_sink: Option<u32> = None;

        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("Sink Input #") {
                current_idx = rest.parse().ok();
                current_sink = None;
            } else if let Some(rest) = trimmed.strip_prefix("Sink: ") {
                current_sink = rest.trim().parse().ok();
            } else if trimmed.contains("application.name") {
                let lower = trimmed.to_lowercase();
                if lower.contains("teams") || lower.contains("microsoft teams") {
                    if let (Some(idx), Some(sink)) = (current_idx, current_sink) {
                        return Some((idx, sink));
                    }
                }
            }
        }

        log::info!("Teams sink input not found in pactl output");
        None
    }
}

#[cfg(target_os = "linux")]
fn get_loopback_device(host: &cpal::Host, preferred_source: Option<&str>) -> Result<cpal::Device> {
    use anyhow::Context;
    use cpal::traits::{DeviceTrait, HostTrait};

    // Log available input devices for debugging
    if let Ok(devices) = host.input_devices() {
        let names: Vec<String> = devices.filter_map(|d| d.name().ok()).collect();
        log::info!("Available input devices: {:?}", names);
    }

    // If we have a preferred source (from per-app routing), find it
    if let Some(preferred) = preferred_source {
        if let Some(device) = host
            .input_devices()?
            .find(|d| d.name().map(|n| n.contains(preferred)).unwrap_or(false))
        {
            log::info!(
                "Using per-app capture device: {}",
                device.name().unwrap_or_default()
            );
            return Ok(device);
        }
        log::warn!("Preferred source '{preferred}' not found, falling back to monitor");
    }

    // PulseAudio/PipeWire monitor sources contain "monitor" in the name
    let monitor_keywords = ["monitor", "Monitor"];
    if let Some(device) = host.input_devices()?.find(|d| {
        d.name()
            .map(|n| monitor_keywords.iter().any(|kw| n.contains(kw)))
            .unwrap_or(false)
    }) {
        log::info!(
            "Found monitor device: {}",
            device.name().unwrap_or_default()
        );
        return Ok(device);
    }

    // Fallback to default input (e.g. microphone)
    log::warn!("No monitor device found, falling back to default input");
    host.default_input_device()
        .context("No input device available. Ensure PulseAudio or PipeWire is running.")
}

#[cfg(target_os = "macos")]
fn get_loopback_device(host: &cpal::Host, _preferred_source: Option<&str>) -> Result<cpal::Device> {
    use anyhow::Context;
    use cpal::traits::{DeviceTrait, HostTrait};

    // Log available input devices for debugging
    if let Ok(devices) = host.input_devices() {
        let names: Vec<String> = devices.filter_map(|d| d.name().ok()).collect();
        log::info!("Available input devices: {:?}", names);
    }

    // Look for known virtual audio devices used for system audio capture
    let virtual_keywords = [
        "blackhole",
        "loopback",
        "soundflower",
        "virtual",
        "screencapture",
    ];
    if let Some(device) = host.input_devices()?.find(|d| {
        d.name()
            .map(|n| {
                let lower = n.to_lowercase();
                virtual_keywords.iter().any(|kw| lower.contains(kw))
            })
            .unwrap_or(false)
    }) {
        log::info!(
            "Found virtual audio device: {}",
            device.name().unwrap_or_default()
        );
        return Ok(device);
    }

    log::warn!("No virtual audio device found. Install BlackHole (https://existential.audio/blackhole/) for system audio capture.");
    host.default_input_device()
        .context("No input device available. Install BlackHole for system audio capture on macOS.")
}
