/*! .docx 正文抽取（方案 §8.4.3：zip + quick-xml 自解，不引原生库）。
   口径：每个 <w:p> 产出一段；<w:t> 文本按出现顺序拼接；段落之间用单个 \n。
   表格里的 <w:p> 同样产出（文档顺序）；域代码（w:instrText / w:delText）与
   mc:Fallback 分支跳过，避免同一段文字出现两次。 */

use crate::limits::{utf16_len, MAX_DOCX_XML_BYTES, MAX_UNITS};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::{BufReader, Read};
use std::path::Path;

/// 从 docx 抽出纯文本；失败返回 E_DOCX_* / E_TOO_LARGE 错误码。
pub fn extract_docx_text(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("E_IO: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("E_DOCX_MALFORMED: {e}"))?;
    let entry = zip
        .by_name("word/document.xml")
        .map_err(|_| String::from("E_DOCX_NO_TEXT: 压缩包里找不到 word/document.xml"))?;
    if entry.size() > MAX_DOCX_XML_BYTES {
        return Err(format!(
            "E_TOO_LARGE: docx 正文 XML 解压后 {} 字节，超过上限 {}",
            entry.size(),
            MAX_DOCX_XML_BYTES
        ));
    }
    let mut xml = Vec::with_capacity(entry.size().min(1 << 20) as usize);
    BufReader::new(entry)
        .take(MAX_DOCX_XML_BYTES)
        .read_to_end(&mut xml)
        .map_err(|e| format!("E_DOCX_MALFORMED: {e}"))?;

    let mut reader = Reader::from_reader(BufReader::new(std::io::Cursor::new(xml)));
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut paras: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_text = false;
    let mut skip_depth = 0usize;
    let mut units = 0usize;

    loop {
        match reader.read_event_into(&mut buf) {
            Err(e) => return Err(format!("E_DOCX_MALFORMED: {e}")),
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => match e.name().local_name().as_ref() {
                "t" => in_text = true,
                "instrText" | "delText" => in_text = false,
                "Fallback" => skip_depth += 1,
                "tab" => cur.push(' '),
                "br" | "cr" => cur.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.name().local_name().as_ref() {
                "p" => paras.push(String::new()),
                "tab" => cur.push(' '),
                _ => {}
            },
            Ok(Event::Text(e)) => {
                if in_text && skip_depth == 0 {
                    let raw: &str = e.as_ref();
                    let s = quick_xml::escape::unescape(raw)
                        .map(|c| c.into_owned())
                        .unwrap_or_else(|_| raw.to_string());
                    units += utf16_len(&s);
                    if units > MAX_UNITS {
                        return Err(format!("E_TOO_LARGE: 正文超过 {MAX_UNITS} 个字符"));
                    }
                    cur.push_str(&s);
                }
            }
            Ok(Event::End(e)) => match e.name().local_name().as_ref() {
                "t" => in_text = false,
                "p" => paras.push(std::mem::take(&mut cur)),
                "Fallback" => skip_depth = skip_depth.saturating_sub(1),
                _ => {}
            },
            Ok(_) => {}
        }
        buf.clear();
    }

    // 抽不到文字（空文档 / 纯图片）不报错：交给内核按「全文为空」判（D-08），
    // 与空 .txt 的行为保持一致。
    Ok(paras.join("\n"))
}
