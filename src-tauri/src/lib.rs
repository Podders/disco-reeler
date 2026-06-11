use reqwest::header::{ACCEPT, AUTHORIZATION, HeaderMap, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{window::Color, AppHandle, Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri_plugin_shell::ShellExt;
use base64::Engine as _;

const APP_USER_AGENT: &str = "Vinyl Reel Recorder/0.1.0";
const DISCOGS_API_BASE: &str = "https://api.discogs.com";
const DISCOGS_COLLECTION_PROGRESS_EVENT: &str = "discogs-collection-progress";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscogsCollectionRelease {
    pub instance_id: u64,
    pub release_id: u64,
    pub title: String,
    pub artist: String,
    pub year: Option<u16>,
    pub label: Option<String>,
    pub cover_image: Option<String>,
    pub thumb: Option<String>,
    pub resource_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DiscogsCollectionResponse {
    releases: Vec<DiscogsCollectionItem>,
    pagination: Option<DiscogsPagination>,
}

#[derive(Debug, Deserialize)]
struct DiscogsCollectionItem {
    id: u64,
    basic_information: DiscogsBasicInformation,
}

#[derive(Debug, Deserialize)]
struct DiscogsBasicInformation {
    id: u64,
    title: String,
    artists: Vec<DiscogsArtist>,
    artists_sort: Option<String>,
    labels: Vec<DiscogsLabel>,
    year: Option<u16>,
    cover_image: Option<String>,
    thumb: Option<String>,
    resource_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DiscogsArtist {
    name: String,
}

#[derive(Debug, Deserialize)]
struct DiscogsLabel {
    name: String,
}

#[derive(Debug, Deserialize)]
struct DiscogsPagination {
    page: u32,
    pages: u32,
    items: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
struct DiscogsCollectionProgress {
    page: u32,
    pages: Option<u32>,
    loaded_releases: usize,
    total_releases: Option<u32>,
    status: &'static str,
}

fn discogs_headers(token: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.discogs.v2+json"),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static(APP_USER_AGENT));

    let auth_value = format!("Discogs token={}", token.trim());
    let auth_header = HeaderValue::from_str(&auth_value)
        .map_err(|_| "The Discogs token contains invalid characters.".to_string())?;
    headers.insert(AUTHORIZATION, auth_header);
    Ok(headers)
}

fn artist_name(info: &DiscogsBasicInformation) -> String {
    info.artists_sort
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| info.artists.first().map(|artist| artist.name.clone()))
        .unwrap_or_else(|| "Unknown artist".to_string())
}

fn label_name(info: &DiscogsBasicInformation) -> Option<String> {
    info.labels.first().map(|label| label.name.clone())
}

fn emit_collection_progress(
    app: &AppHandle,
    page: u32,
    pages: Option<u32>,
    loaded_releases: usize,
    total_releases: Option<u32>,
    status: &'static str,
) {
    let payload = DiscogsCollectionProgress {
        page,
        pages,
        loaded_releases,
        total_releases,
        status,
    };

    let _ = app.emit(DISCOGS_COLLECTION_PROGRESS_EVENT, payload);
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn downloads_dir() -> Option<PathBuf> {
    home_dir().map(|home| home.join("Downloads"))
}

fn sanitize_file_name(file_name: &str) -> String {
    let trimmed = file_name.trim();
    let fallback = "vinyl-reel-recording.mp4";

    let candidate = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };

    candidate
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => character,
        })
        .collect()
}

fn recording_output_file_name(file_name: &str) -> String {
    let sanitized = sanitize_file_name(file_name);
    let path = Path::new(&sanitized);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("vinyl-reel-recording");

    format!("{stem}.mp4")
}

fn temp_recording_dir() -> PathBuf {
    env::temp_dir().join("Vinyl Reel Recorder")
}

fn unique_recording_source_path() -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_micros())
        .unwrap_or_default();

    temp_recording_dir().join(format!("recording-source-{timestamp}.webm"))
}

fn unique_temp_asset_path(extension: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_micros())
        .unwrap_or_default();

    temp_recording_dir().join(format!("recording-asset-{timestamp}.{extension}"))
}

fn decode_data_url(data_url: &str) -> Result<(Vec<u8>, Option<String>), String> {
    let trimmed = data_url.trim();
    if !trimmed.starts_with("data:") {
        return Err("Expected a data URL.".to_string());
    }

    let base64_marker = ";base64,";
    let marker_index = trimmed
        .find(base64_marker)
        .ok_or_else(|| "The data URL is missing its base64 payload marker.".to_string())?;

    let metadata = &trimmed[5..marker_index];
    let payload = &trimmed[marker_index + base64_marker.len()..];
    let mime = metadata
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|error| format!("Failed to decode data URL payload: {error}"))?;

    Ok((bytes, mime))
}

fn decode_base64_input(input: &str) -> Result<Vec<u8>, String> {
    let trimmed = input.trim();

    if trimmed.starts_with("data:") {
        let (bytes, _) = decode_data_url(trimmed)?;
        return Ok(bytes);
    }

    base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .map_err(|error| format!("Failed to decode recording data: {error}"))
}

fn extension_for_mime(mime: Option<&str>) -> &'static str {
    match mime.unwrap_or("").trim().to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "bin",
    }
}

fn open_path_with_system(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open path: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open path: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open path: {error}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening folders is not supported on this platform.".to_string())
}

fn cache_root_dir() -> Option<PathBuf> {
    home_dir().map(|home| home.join("Vinyl Reel Recorder").join("cache"))
}

fn discogs_cache_path(username: &str) -> Option<PathBuf> {
    let username = username.trim();
    if username.is_empty() {
        return None;
    }

    let sanitized_username = sanitize_file_name(username);
    cache_root_dir().map(|root| root.join(format!("discogs-collection-{sanitized_username}.json")))
}

#[tauri::command]
async fn discogs_collection_releases(
    app: AppHandle,
    username: String,
    token: String,
    folder_id: Option<u64>,
) -> Result<Vec<DiscogsCollectionRelease>, String> {
    let username = username.trim();
    let token = token.trim();

    if username.is_empty() {
        return Err("Discogs username is required.".to_string());
    }

    if token.is_empty() {
        return Err("Discogs token is required.".to_string());
    }

    let folder_id = folder_id.unwrap_or(0);
    let per_page: u32 = 100;
    let client = reqwest::Client::builder()
        .default_headers(discogs_headers(token)?)
        .build()
        .map_err(|error| format!("Failed to build Discogs client: {error}"))?;

    let mut collected = Vec::new();
    let mut seen_instance_ids = HashSet::new();
    let mut page: u32 = 1;
    let mut total_pages: Option<u32> = None;
    let mut total_releases: Option<u32> = None;

    emit_collection_progress(&app, 0, None, 0, None, "starting");

    loop {
        let url = format!(
            "{DISCOGS_API_BASE}/users/{username}/collection/folders/{folder_id}/releases?page={page}&per_page={per_page}"
        );

        let response = client
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Discogs request failed: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(if body.trim().is_empty() {
                format!("Discogs request failed with status {status}.")
            } else {
                format!("Discogs request failed with status {status}: {body}")
            });
        }

        let parsed: DiscogsCollectionResponse = response
            .json()
            .await
            .map_err(|error| format!("Failed to parse Discogs response: {error}"))?;

        let current_pages = parsed.pagination.as_ref().map(|pagination| pagination.pages);
        total_pages = current_pages.or(total_pages);
        total_releases = parsed
            .pagination
            .as_ref()
            .and_then(|pagination| pagination.items)
            .or(total_releases);

        for item in parsed.releases {
            let info = item.basic_information;
            if !seen_instance_ids.insert(item.id) {
                continue;
            }

            let artist = artist_name(&info);
            let label = label_name(&info);
            let title = info.title;
            let year = info.year;
            let cover_image = info.cover_image;
            let thumb = info.thumb;
            let resource_url = info.resource_url;

            collected.push(DiscogsCollectionRelease {
                instance_id: item.id,
                release_id: info.id,
                title,
                artist,
                year,
                label,
                cover_image,
                thumb,
                resource_url,
            });
        }

        let current_pages = parsed.pagination.as_ref().map(|pagination| pagination.pages);
        emit_collection_progress(
            &app,
            page,
            current_pages.or(total_pages),
            collected.len(),
            total_releases,
            "page-loaded",
        );

        let Some(pagination) = parsed.pagination else {
            break;
        };

        let _ = pagination.page;

        if page >= pagination.pages {
            break;
        }

        page += 1;
    }

    emit_collection_progress(
        &app,
        total_pages.unwrap_or(page),
        total_pages,
        collected.len(),
        total_releases,
        "complete",
    );

    Ok(collected)
}

#[tauri::command]
fn load_discogs_collection_cache(
    username: String,
) -> Result<Option<Vec<DiscogsCollectionRelease>>, String> {
    let Some(path) = discogs_cache_path(&username) else {
        return Ok(None);
    };

    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read Discogs cache: {error}"))?;

    let releases = serde_json::from_str::<Vec<DiscogsCollectionRelease>>(&contents)
        .map_err(|error| format!("Failed to parse Discogs cache: {error}"))?;

    Ok(Some(releases))
}

#[tauri::command]
fn save_discogs_collection_cache(
    username: String,
    releases: Vec<DiscogsCollectionRelease>,
) -> Result<(), String> {
    let Some(path) = discogs_cache_path(&username) else {
        return Err("Discogs username is required to save the cache.".to_string());
    };

    let Some(parent) = path.parent() else {
        return Err("Could not determine the Discogs cache directory.".to_string());
    };

    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create Discogs cache directory: {error}"))?;

    let json = serde_json::to_string_pretty(&releases)
        .map_err(|error| format!("Failed to serialize Discogs cache: {error}"))?;

    fs::write(&path, json)
        .map_err(|error| format!("Failed to write Discogs cache: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn fetch_remote_image_data_url(url: String) -> Result<String, String> {
    let url = url.trim();

    if url.is_empty() {
        return Err("Image URL is required.".to_string());
    }

    let response = reqwest::get(url)
        .await
        .map_err(|error| format!("Failed to fetch image: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(if body.trim().is_empty() {
            format!("Failed to fetch image with status {status}.")
        } else {
            format!("Failed to fetch image with status {status}: {body}")
        });
    }

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .trim()
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read image response: {error}"))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
async fn save_recording_file(file_name: String, base64_data: String) -> Result<String, String> {
    let downloads = downloads_dir().ok_or_else(|| "Could not locate the Downloads folder.".to_string())?;
    let target_dir = downloads.join("Vinyl Reel Recorder");

    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Failed to create recording folder: {error}"))?;

    let file_name = sanitize_file_name(&file_name);
    let target_path = target_dir.join(file_name);

    let bytes = decode_base64_input(&base64_data)?;

    fs::write(&target_path, bytes)
        .map_err(|error| format!("Failed to write recording file: {error}"))?;

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn read_file_base64(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(file_path.trim());

    if !path.exists() {
      return Err("The requested file does not exist.".to_string());
    }

    let bytes = fs::read(&path).map_err(|error| format!("Failed to read file: {error}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn encode_recording_with_ffmpeg(
    app_handle: AppHandle,
    file_name: String,
    base64_data: String,
    artwork_data_url: Option<String>,
    duration_seconds: f64,
    output_width: u32,
    output_height: u32,
) -> Result<String, String> {
    let bytes = decode_base64_input(&base64_data)?;

    let temp_dir = temp_recording_dir();
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create FFmpeg temp directory: {error}"))?;

    let input_path = unique_recording_source_path();
    fs::write(&input_path, bytes)
        .map_err(|error| format!("Failed to write temporary recording: {error}"))?;

    let downloads = downloads_dir().ok_or_else(|| "Could not locate the Downloads folder.".to_string())?;
    let target_dir = downloads.join("Vinyl Reel Recorder");
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Failed to create recording folder: {error}"))?;

    let output_path = target_dir.join(recording_output_file_name(&file_name));
    let output_width = output_width.max(1);
    let output_height = output_height.max(1);
    let is_landscape_layout = output_width > output_height;
    let camera_section_height = if output_height <= 1 {
        1
    } else {
        ((output_height as f64) * 120.0 / 271.0)
            .round()
            .clamp(1.0, (output_height - 1) as f64) as u32
    };
    let artwork_section_height = output_height - camera_section_height;
    let camera_section_width = if output_width <= 1 {
        1
    } else {
        output_width / 2
    };
    let artwork_section_width = output_width.saturating_sub(camera_section_width);
    let mut artwork_path: Option<PathBuf> = None;

    let mut ffmpeg_args: Vec<String> = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().to_string(),
    ];

    if let Some(artwork_data_url) = artwork_data_url.as_deref() {
        let (artwork_bytes, mime) = decode_data_url(artwork_data_url)?;
        let extension = extension_for_mime(mime.as_deref());
        let path = unique_temp_asset_path(extension);
        fs::write(&path, artwork_bytes)
            .map_err(|error| format!("Failed to write temporary artwork image: {error}"))?;
        ffmpeg_args.push("-loop".to_string());
        ffmpeg_args.push("1".to_string());
        ffmpeg_args.push("-i".to_string());
        ffmpeg_args.push(path.to_string_lossy().to_string());
        artwork_path = Some(path);
    }

    let duration_seconds = duration_seconds.max(0.1);
    let filter_complex = if is_landscape_layout {
        if artwork_path.is_some() {
            let artwork_crop = format!("crop={artwork_section_width}:{output_height}:0:0");
            format!(
                "[0:v]fps=60,scale={camera_section_width}:{output_height}:force_original_aspect_ratio=increase,crop={camera_section_width}:{output_height},setsar=1[left];[1:v]scale={artwork_section_width}:{output_height}:force_original_aspect_ratio=increase,{artwork_crop},setsar=1[right];[left][right]hstack=inputs=2,format=yuv420p[v]"
            )
        } else {
            format!(
                "[0:v]fps=60,scale={camera_section_width}:{output_height}:force_original_aspect_ratio=increase,crop={camera_section_width}:{output_height},setsar=1[left];color=c=black:s={artwork_section_width}x{output_height}:r=60[right];[left][right]hstack=inputs=2,format=yuv420p[v]"
            )
        }
    } else if artwork_path.is_some() {
        let artwork_crop = format!("crop={output_width}:{artwork_section_height}:(iw-ow)/2:0");
        format!(
            "[0:v]fps=60,scale={output_width}:{camera_section_height}:force_original_aspect_ratio=increase,crop={output_width}:{camera_section_height},setsar=1[top];[1:v]scale={output_width}:{artwork_section_height}:force_original_aspect_ratio=increase,{artwork_crop},setsar=1[bottom];[top][bottom]vstack=inputs=2,format=yuv420p[v]"
        )
    } else {
        format!(
            "[0:v]fps=60,scale={output_width}:{camera_section_height}:force_original_aspect_ratio=increase,crop={output_width}:{camera_section_height},setsar=1[top];color=c=black:s={output_width}x{artwork_section_height}:r=60[bottom];[top][bottom]vstack=inputs=2,format=yuv420p[v]"
        )
    };

    ffmpeg_args.push("-t".to_string());
    ffmpeg_args.push(format!("{duration_seconds:.3}"));
    ffmpeg_args.push("-filter_complex".to_string());
    ffmpeg_args.push(filter_complex);
    ffmpeg_args.push("-map".to_string());
    ffmpeg_args.push("[v]".to_string());
    ffmpeg_args.push("-map".to_string());
    ffmpeg_args.push("0:a?".to_string());
    ffmpeg_args.push("-shortest".to_string());
    ffmpeg_args.push("-c:v".to_string());
    ffmpeg_args.push("libx264".to_string());
    ffmpeg_args.push("-preset".to_string());
    ffmpeg_args.push("veryfast".to_string());
    ffmpeg_args.push("-crf".to_string());
    ffmpeg_args.push("18".to_string());
    ffmpeg_args.push("-c:a".to_string());
    ffmpeg_args.push("aac".to_string());
    ffmpeg_args.push("-ac".to_string());
    ffmpeg_args.push("2".to_string());
    ffmpeg_args.push("-ar".to_string());
    ffmpeg_args.push("48000".to_string());
    ffmpeg_args.push("-b:a".to_string());
    ffmpeg_args.push("192k".to_string());
    ffmpeg_args.push("-movflags".to_string());
    ffmpeg_args.push("+faststart".to_string());
    ffmpeg_args.push(output_path.to_string_lossy().to_string());

    let output = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| format!("FFmpeg sidecar is unavailable: {error}"))?
        .args(ffmpeg_args)
        .output()
        .await
        .map_err(|error| format!("Failed to launch FFmpeg sidecar: {error}"))?;

    if let Err(error) = fs::remove_file(&input_path) {
        if output_path.exists() {
            let _ = fs::remove_file(&output_path);
        }
        if let Some(path) = artwork_path.as_ref() {
            let _ = fs::remove_file(path);
        }

        return Err(format!("Failed to clean up temporary recording: {error}"));
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr)
            .trim()
            .to_string();

        if output_path.exists() {
            let _ = fs::remove_file(&output_path);
        }
        if let Some(path) = artwork_path.as_ref() {
            let _ = fs::remove_file(path);
        }

        let details = if stderr.is_empty() {
            format!(
                "FFmpeg failed to encode the recording (exit code {}).",
                output
                    .status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            )
        } else {
            format!("FFmpeg failed to encode the recording: {stderr}")
        };

        return Err(details);
    }

    if let Some(path) = artwork_path.as_ref() {
        let _ = fs::remove_file(path);
    }

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_containing_folder(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path.trim());
    let folder = path
        .parent()
        .ok_or_else(|| "Could not determine the containing folder.".to_string())?;

    open_path_with_system(folder)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(Color(4, 7, 12, 255)));

                #[cfg(target_os = "macos")]
                let _ = window.set_title_bar_style(TitleBarStyle::Transparent);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            discogs_collection_releases,
            load_discogs_collection_cache,
            save_discogs_collection_cache,
            fetch_remote_image_data_url,
            save_recording_file,
            read_file_base64,
            encode_recording_with_ffmpeg,
            open_containing_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
