/*! 输入上限与格式判定（方案 §8.4.4；v1.4 把单份正文上限改为 20,000）。
   这些是工程取值，非原方案给定值，可调（Q-20）。 */

/// 单个文件的字节上限：8 MB
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
/// 单份正文的 UTF-16 码元上限：20,000（与内核 chars 同口径；emoji 等代理对算 2）
pub const MAX_UNITS: usize = 20_000;
/// 批量份数上限
pub const MAX_BATCH_FILES: usize = 200;
/// 批总字节上限：200 MB
pub const MAX_BATCH_BYTES: u64 = 200 * 1024 * 1024;
/// docx 内 word/document.xml 解压后的上限（防 zip bomb）
pub const MAX_DOCX_XML_BYTES: u64 = 64 * 1024 * 1024;

/// 与 JS 真源一致的口径：按 UTF-16 码元计数（代理对算 2）
pub fn utf16_len(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16()).sum()
}

/// 超长文案（唯一真源）：文件路径与粘贴路径共用，保证「文案里的数字 == 实际阈值」。
pub fn too_long(n: usize) -> String {
    format!("E_TOO_LARGE: 正文 {n} 个字符，超过单份上限 {MAX_UNITS}")
}
