/*! C++ 内核的 Rust 绑定层（唯一 unsafe 边界）。
   约定：C 侧返回的字符串一律由 yyb_free 释放；NULL 表示模板 ID 非法。 */

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

extern "C" {
    fn yyb_check_json_n(text: *const c_char, text_len: usize, template_id: *const c_char) -> *mut c_char;
    fn yyb_list_templates_json() -> *mut c_char;
    fn yyb_list_samples_json() -> *mut c_char;
    fn yyb_rule_version() -> *const c_char;
    fn yyb_free(p: *mut c_char);
}

fn take(p: *mut c_char) -> Option<String> {
    if p.is_null() {
        return None;
    }
    let s = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    unsafe { yyb_free(p) };
    Some(s)
}

/// 规则版本号，例如 "yyb-2"。前端展示、CI 校验、报告落款都用它。
pub fn rule_version() -> String {
    unsafe { CStr::from_ptr(yyb_rule_version()) }
        .to_string_lossy()
        .into_owned()
}

/// 校验一段文本。模板 ID 非法时返回 Err("E_TEMPLATE")。
pub fn check(text: &str, template_id: &str) -> Result<serde_json::Value, String> {
    let tpl = CString::new(template_id).map_err(|_| "E_TEMPLATE".to_string())?;
    let raw = unsafe {
        yyb_check_json_n(
            text.as_ptr() as *const c_char,
            text.len(),
            tpl.as_ptr(),
        )
    };
    let s = take(raw).ok_or_else(|| "E_TEMPLATE".to_string())?;
    serde_json::from_str(&s).map_err(|e| format!("E_JSON: {e}"))
}

pub fn templates() -> Result<serde_json::Value, String> {
    let s = take(unsafe { yyb_list_templates_json() }).ok_or("E_JSON")?;
    serde_json::from_str(&s).map_err(|_| "E_JSON".to_string())
}

pub fn samples() -> Result<serde_json::Value, String> {
    let s = take(unsafe { yyb_list_samples_json() }).ok_or("E_JSON")?;
    serde_json::from_str(&s).map_err(|_| "E_JSON".to_string())
}
