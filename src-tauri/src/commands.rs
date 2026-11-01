/*! Tauri 命令层：前端唯一的入口。所有判定都转发给 C++ 内核，
   这里只做 IO（读文件、写报告）与错误整形，不复制任何规则。 */

use crate::limits::{self, MAX_BATCH_BYTES, MAX_BATCH_FILES, MAX_UNITS};
use crate::{core_ffi, text_io};
use serde::Serialize;

#[derive(Serialize)]
pub struct CheckOne {
    pub name: String,
    pub path: String,
    pub encoding: String,
    pub bytes: usize,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn api_version() -> String {
    core_ffi::rule_version()
}

#[tauri::command]
pub fn list_templates() -> Result<serde_json::Value, String> {
    core_ffi::templates()
}

#[tauri::command]
pub fn list_samples() -> Result<serde_json::Value, String> {
    core_ffi::samples()
}

#[tauri::command]
pub fn check_text(text: String, template_id: String) -> Result<serde_json::Value, String> {
    // 粘贴路径与文件路径共用同一上限与同一文案（limits::too_long）
    let n = limits::utf16_len(&text);
    if n > MAX_UNITS {
        return Err(limits::too_long(n));
    }
    core_ffi::check(&text, &template_id)
}

#[tauri::command]
pub fn load_text_file(path: String) -> Result<text_io::LoadedText, String> {
    text_io::read_text_file(&path)
}

/// 批量：逐文件读入（自动 UTF-8/UTF-16/GB18030）→ 同模板校验。
/// 单个文件失败不中断其余文件，错误随行返回。
#[tauri::command]
pub fn check_files(paths: Vec<String>, template_id: String) -> Vec<CheckOne> {
    // §8.4.4 上限：份数 / 总字节。超限即停，已处理的结果照常返回，末尾补一条汇总错误。
    if paths.len() > MAX_BATCH_FILES {
        let mut done: Vec<CheckOne> = paths
            .iter()
            .take(MAX_BATCH_FILES)
            .cloned()
            .collect::<Vec<String>>()
            .into_iter()
            .map(|path| one_file(&path, &template_id))
            .collect();
        done.push(batch_limit_row(format!(
            "E_TOO_LARGE: 一次最多 {MAX_BATCH_FILES} 份，本次 {} 份，只校验了前 {MAX_BATCH_FILES} 份",
            paths.len()
        )));
        return done;
    }
    let mut total: u64 = 0;
    let mut out: Vec<CheckOne> = Vec::with_capacity(paths.len());
    for path in paths {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if total + size > MAX_BATCH_BYTES {
            out.push(batch_limit_row(format!(
                "E_TOO_LARGE: 批总字节超过上限 {MAX_BATCH_BYTES}，从此处起停止"
            )));
            return out;
        }
        total += size;
        out.push(one_file(&path, &template_id));
    }
    out
}

fn batch_limit_row(error: String) -> CheckOne {
    CheckOne {
        name: String::from("（批次上限）"),
        path: String::new(),
        encoding: String::from("-"),
        bytes: 0,
        result: None,
        error: Some(error),
    }
}

fn one_file(path: &str, template_id: &str) -> CheckOne {
    match text_io::read_text_file(path) {
        Ok(t) => match core_ffi::check(&t.text, template_id) {
            Ok(v) => CheckOne {
                name: t.name,
                path: t.path,
                encoding: t.encoding,
                bytes: t.bytes,
                result: Some(v),
                error: None,
            },
            Err(e) => CheckOne {
                name: t.name,
                path: t.path,
                encoding: t.encoding,
                bytes: t.bytes,
                result: None,
                error: Some(e),
            },
        },
        Err(e) => CheckOne {
            name: std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string()),
            path: path.to_string(),
            encoding: String::from("-"),
            bytes: 0,
            result: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
pub async fn pick_text_files(app: tauri::AppHandle) -> Option<Vec<String>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("选择要校验的文本")
        .add_filter("文本与 Word", &["txt", "md", "markdown", "text", "docx"])
        .add_filter("所有文件", &["*"])
        .blocking_pick_files()?;
    Some(
        picked
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
    )
}

/// 把前端拼好的报告（Markdown）写到用户选的位置，返回落盘路径。
/// 只读：当前输入上限。前端用它显示「上限 20,000 字」等提示，
/// 避免把阈值在前端再抄一份（真源仍是 limits.rs）。
#[tauri::command]
pub fn limits_info() -> serde_json::Value {
    serde_json::json!({
        "maxUnits": MAX_UNITS,
        "maxFileBytes": limits::MAX_FILE_BYTES,
        "maxBatchFiles": MAX_BATCH_FILES,
        "maxBatchBytes": MAX_BATCH_BYTES,
    })
}

#[tauri::command]
pub async fn save_report(
    app: tauri::AppHandle,
    content: String,
    suggested_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let target = app
        .dialog()
        .file()
        .set_title("保存校验报告")
        .set_file_name(&suggested_name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();
    let Some(fp) = target else { return Ok(None) };
    let path = fp.into_path().map_err(|e| format!("E_PATH: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("E_IO: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
