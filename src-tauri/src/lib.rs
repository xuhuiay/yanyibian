/*! 验一遍 0.1.0 —— C++ 规则内核 + Tauri 2 外壳。
   分层：ui/（前端，纯 HTML/JS）→ commands.rs（IO 与整形）→ core_ffi（C ABI）
        → core/src 下的 .cpp（判定内核，与 验一遍/yanyibian.js 逐键等价）。 */

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub mod ai;
pub mod api;
pub mod commands;
pub mod core_ffi;
pub mod docx;
pub mod limits;
pub mod text_io;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::api_version,
            commands::list_templates,
            commands::list_samples,
            commands::check_text,
            commands::load_text_file,
            commands::check_files,
            commands::pick_text_files,
            commands::save_report,
            commands::limits_info,
            ai::ai_get_config,
            ai::ai_set_config,
            ai::ai_cancel,
            ai::ai_revise,
        ])
        .setup(|app| {
            build_main_window(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动失败：Tauri 事件循环异常");
}

/// 挑选 WebView2 的用户数据目录（按可用性降级，第一个「能建能写」的胜出）。
///
/// 背景（0.1.0 实测，见 docs/build-and-run.md 的「低完整性环境」）：
/// ① 宿主 exe 位于含中文的路径时，若让 WebView2 自行决定数据目录，
///    创建环境会以 HRESULT 0x80070005（拒绝访问）失败并在 setup 阶段 panic；
/// ② 进程若被以 Low 完整性级别（S-1-16-4096）启动，则对 %LOCALAPPDATA%
///    （Medium IL）只读，create_dir_all 直接返回 EACCES。
/// 因此这里按 %LOCALAPPDATA% → %LOCALAPPDATA%\..\LocalLow（Low IL 可写区）
/// → 系统 TEMP 的顺序探测，探测方式是真建目录再写一个探针文件。
fn pick_webview_data_dir(app: &tauri::App) -> std::path::PathBuf {
    let id = app.config().identifier.clone();
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(dir) = app.path().app_local_data_dir() {
        candidates.push(dir.join("webview"));
        if let Some(appdata) = dir.parent().and_then(|local| local.parent()) {
            candidates.push(appdata.join("LocalLow").join(&id).join("webview"));
        }
    }
    candidates.push(std::env::temp_dir().join(format!("{id}-webview")));

    for dir in &candidates {
        if std::fs::create_dir_all(dir).is_err() {
            continue;
        }
        let probe = dir.join(".write-probe");
        if std::fs::write(&probe, b"ok").is_ok() {
            let _ = std::fs::remove_file(&probe);
            return dir.clone();
        }
    }
    std::env::temp_dir().join(format!("{id}-webview"))
}

/// 显式创建主窗口，并把 WebView2 的用户数据目录钉到可写位置。
fn build_main_window(app: &mut tauri::App) -> tauri::Result<()> {
    let data_dir = pick_webview_data_dir(app);
    if cfg!(debug_assertions) {
        eprintln!("[yyb] webview data dir = {}", data_dir.display());
    }

    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("验一遍 · 交付前先验一遍")
        .inner_size(1160.0, 780.0)
        .min_inner_size(940.0, 640.0)
        .center()
        .data_directory(data_dir)
        .build()
        .map_err(|e| { eprintln!("[yyb] build webview failed: {e}"); e })?;

    Ok(())
}