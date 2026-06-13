#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

struct AppState {
    current_path: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasFile {
    path: Option<String>,
    text: String,
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "canvas".to_string()
    } else {
        trimmed.to_string()
    }
}

fn read_canvas(path: PathBuf, state: &State<AppState>) -> Result<CanvasFile, String> {
    let text = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    *state.current_path.lock().map_err(|err| err.to_string())? = Some(path.clone());
    Ok(CanvasFile {
        path: Some(path_to_string(&path)),
        text,
    })
}

fn save_as_with_dialog(text: &str, title: &str, state: &State<AppState>) -> Result<Option<String>, String> {
    let suggested = format!("{}.icv", sanitize_name(title));
    let Some(path) = rfd::FileDialog::new()
        .add_filter("ICE Canvas", &["icv", "canvas"])
        .set_file_name(&suggested)
        .save_file()
    else {
        return Ok(None);
    };

    fs::write(&path, text).map_err(|err| err.to_string())?;
    *state.current_path.lock().map_err(|err| err.to_string())? = Some(path.clone());
    Ok(Some(path_to_string(&path)))
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let Some((_, body)) = data_url.split_once(',') else {
        return Err("Invalid data URL".to_string());
    };
    general_purpose::STANDARD
        .decode(body)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn get_startup_canvas(state: State<AppState>) -> Result<Option<CanvasFile>, String> {
    let Some(arg) = std::env::args_os().nth(1) else {
        return Ok(None);
    };
    let path = PathBuf::from(arg);
    if !path.exists() {
        return Ok(None);
    }
    read_canvas(path, &state).map(Some)
}

#[tauri::command]
fn open_canvas_dialog(state: State<AppState>) -> Result<Option<CanvasFile>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("ICE Canvas", &["icv", "canvas"])
        .pick_file()
    else {
        return Ok(None);
    };
    read_canvas(path, &state).map(Some)
}

#[tauri::command]
fn save_canvas(text: String, title: String, state: State<AppState>) -> Result<Option<String>, String> {
    let current = state.current_path.lock().map_err(|err| err.to_string())?.clone();
    if let Some(path) = current {
        fs::write(&path, text).map_err(|err| err.to_string())?;
        Ok(Some(path_to_string(&path)))
    } else {
        save_as_with_dialog(&text, &title, &state)
    }
}

#[tauri::command]
fn save_canvas_as(text: String, title: String, state: State<AppState>) -> Result<Option<String>, String> {
    save_as_with_dialog(&text, &title, &state)
}

#[tauri::command]
fn save_attachment(data_url: String, filename: String) -> Result<Option<String>, String> {
    let bytes = decode_data_url(&data_url)?;
    let suggested = sanitize_name(&filename);
    let Some(path) = rfd::FileDialog::new().set_file_name(&suggested).save_file() else {
        return Ok(None);
    };
    fs::write(&path, bytes).map_err(|err| err.to_string())?;
    Ok(Some(path_to_string(&path)))
}

/// Only http(s) URLs with no control/whitespace characters are allowed.
/// Embedded whitespace and control chars are rejected to block argument and
/// command injection regardless of the launch mechanism.
fn is_safe_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return false;
    }
    !url.chars().any(|c| c.is_control() || c.is_whitespace())
}

#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    if !is_safe_http_url(&url) {
        return Err("Invalid URL".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        // ShellExecuteW passes the URL straight to the shell's "open" verb as a
        // single wide string — no cmd.exe / command-line parsing, so URL
        // characters like & cannot be interpreted as command separators.
        use windows::core::HSTRING;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let operation = HSTRING::from("open");
        let file = HSTRING::from(url.as_str());
        let result = unsafe {
            ShellExecuteW(
                Some(HWND::default()),
                &operation,
                &file,
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        // ShellExecuteW returns a value > 32 on success.
        if (result.0 as isize) <= 32 {
            return Err("Failed to open URL".to_string());
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            current_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_canvas,
            open_canvas_dialog,
            save_canvas,
            save_canvas_as,
            save_attachment,
            open_in_browser
        ])
        .run(tauri::generate_context!())
        .expect("error while running ICE Canvas");
}
