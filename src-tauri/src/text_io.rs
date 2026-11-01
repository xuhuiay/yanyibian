/*! 文本读入与解码：UTF-8 / UTF-16(BOM) / GB18030（Q-04）+ .docx（§8.4.3）。
   上限与「是不是文本」的判定见 limits.rs（§8.4.4）；pdf 仍未支持（R-22 / Q-22）。 */

use crate::docx;
use crate::limits::{too_long, utf16_len, MAX_FILE_BYTES, MAX_UNITS};
use std::path::Path;

#[derive(serde::Serialize)]
pub struct LoadedText {
    pub path: String,
    pub name: String,
    pub encoding: String,
    pub text: String,
    pub bytes: usize,
}

fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

pub fn decode_bytes(bytes: &[u8]) -> (String, String) {
    // 1. UTF-16 BOM
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return (strip_bom(&String::from_utf16_lossy(&units)).to_string(), "UTF-16LE".into());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return (strip_bom(&String::from_utf16_lossy(&units)).to_string(), "UTF-16BE".into());
    }
    // 2. 严格 UTF-8
    if let Ok(s) = std::str::from_utf8(bytes) {
        return (strip_bom(s).to_string(), "UTF-8".into());
    }
    // 3. GB18030（Q-04：兼容 GBK/GB2312 的旧稿子）
    let (cow, _, _) = encoding_rs::GB18030.decode(bytes);
    (strip_bom(&cow).to_string(), "GB18030".into())
}

/// 文本判定（R-15）：GB18030 分支几乎不会失败，所以只看解码结果是不够的，
/// 需要「字节里没有 NUL」「替换符占比 ≤2%」「C0 控制符占比 ≤5%」三条兜底。
fn looks_like_text(bytes: &[u8], encoding: &str, text: &str) -> bool {
    if encoding.starts_with("UTF-16") {
        return true; // UTF-16 正文天然含 0x00，按字节判会误杀
    }
    let sample = &bytes[..bytes.len().min(4096)];
    if sample.contains(&0u8) {
        return false;
    }
    let mut total = 0usize;
    let mut bad = 0usize;
    let mut ctrl = 0usize;
    for c in text.chars() {
        total += 1;
        if c == '\u{FFFD}' {
            bad += 1;
        }
        let u = c as u32;
        if u < 0x20 && u != 0x09 && u != 0x0A && u != 0x0D && u != 0x0C {
            ctrl += 1;
        }
        if total >= 4096 {
            break;
        }
    }
    if total == 0 {
        return true; // 空文件交给内核按「全文为空」判（D-08）
    }
    if bad * 50 > total {
        return false;
    }
    if ctrl * 20 > total {
        return false;
    }
    true
}

fn name_of(p: &Path, path: &str) -> String {
    p.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

pub fn read_text_file(path: &str) -> Result<LoadedText, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "pdf" {
        return Err(String::from(
            "E_UNSUPPORTED_FORMAT: .pdf（选型 lopdf 0.46.0 已定，尚未实施；见 §8.4.3 / Q-22）",
        ));
    }
    if ext == "doc" {
        return Err(String::from(
            "E_UNSUPPORTED_FORMAT: .doc（Word 97-2003 二进制格式，是否支持待定：Q-23）",
        ));
    }

    let meta = std::fs::metadata(p).map_err(|e| format!("E_IO: {e}"))?;
    let len = meta.len();
    if len > MAX_FILE_BYTES {
        return Err(format!(
            "E_TOO_LARGE: {len} 字节，超过单文件上限 {MAX_FILE_BYTES} 字节"
        ));
    }

    if ext == "docx" {
        let text = docx::extract_docx_text(p)?;
        if utf16_len(&text) > MAX_UNITS {
            return Err(too_long(utf16_len(&text)));
        }
        return Ok(LoadedText {
            path: path.to_string(),
            name: name_of(p, path),
            encoding: String::from("DOCX"),
            text,
            bytes: len as usize,
        });
    }

    let bytes = std::fs::read(p).map_err(|e| format!("E_IO: {e}"))?;
    let (text, encoding) = decode_bytes(&bytes);
    if !looks_like_text(&bytes, &encoding, &text) {
        return Err(format!(
            "E_NOT_TEXT: {ext} 后缀但这个文件不像文本（含 NUL 或大量控制符），可能在选文件时选错了"
        ));
    }
    if utf16_len(&text) > MAX_UNITS {
        return Err(too_long(utf16_len(&text)));
    }
    Ok(LoadedText {
        path: path.to_string(),
        name: name_of(p, path),
        encoding,
        text,
        bytes: len as usize,
    })
}
