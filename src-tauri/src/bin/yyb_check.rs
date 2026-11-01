/*! yyb-check —— 与 GUI 共用同一个内核绑定层的命令行校验器。
   用途：无图形界面时验收内核链路（CI / 装机自检 / 排查"到底是 UI 还是内核的问题"）。
   用法：
     yyb-check --version
     yyb-check --templates | --samples
     yyb-check <模板ID> <文本文件> [更多文件...]
   输出：每个文件一行 JSON（与 C++ 内核 format() 结果同构），退出码 0。
   任一文件读入/模板失败 → 该行输出 {"error":...}，退出码 1。 */

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: yyb-check --version | --templates | --samples | --dump <文件...> | <模板ID> <文件...>");
        return ExitCode::from(2);
    }
    match args[0].as_str() {
        "--version" => {
            println!("{}", yanyibian_lib::core_ffi::rule_version());
            ExitCode::SUCCESS
        }
        "--templates" => match yanyibian_lib::core_ffi::templates() {
            Ok(v) => {
                println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("{e}");
                ExitCode::from(1)
            }
        },
        "--samples" => match yanyibian_lib::core_ffi::samples() {
            Ok(v) => {
                println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("{e}");
                ExitCode::from(1)
            }
        },
        "--dump" => {
            // 排障用：把读入层抽出的正文原样打印成 JSON 字符串（不含判定结果）
            let files = &args[1..];
            if files.is_empty() {
                eprintln!("usage: yyb-check --dump <文件...>");
                return ExitCode::from(2);
            }
            let mut bad = false;
            for f in files {
                let line = match yanyibian_lib::text_io::read_text_file(f) {
                    Ok(t) => serde_json::json!({
                        "file": t.path,
                        "encoding": t.encoding,
                        "bytes": t.bytes,
                        "text": t.text,
                    })
                    .to_string(),
                    Err(e) => {
                        bad = true;
                        serde_json::json!({ "file": f, "error": e }).to_string()
                    }
                };
                println!("{line}");
            }
            if bad { ExitCode::from(1) } else { ExitCode::SUCCESS }
        }
        tpl => {
            let files = &args[1..];
            if files.is_empty() {
                eprintln!("usage: yyb-check <模板ID> <文件...>");
                return ExitCode::from(2);
            }
            let mut bad = false;
            for f in files {
                let line = match yanyibian_lib::text_io::read_text_file(f) {
                    Ok(t) => match yanyibian_lib::core_ffi::check(&t.text, tpl) {
                        Ok(v) => {
                            let mut obj = serde_json::Map::new();
                            obj.insert("file".into(), serde_json::Value::String(t.path.clone()));
                            obj.insert("encoding".into(), serde_json::Value::String(t.encoding));
                            obj.insert("result".into(), v);
                            serde_json::to_string(&obj).unwrap_or_default()
                        }
                        Err(e) => {
                            bad = true;
                            format!("{{\"file\":{},\"error\":{}}}", q(&t.path), q(&e))
                        }
                    },
                    Err(e) => {
                        bad = true;
                        format!("{{\"file\":{},\"error\":{}}}", q(f), q(&e))
                    }
                };
                println!("{line}");
            }
            if bad {
                ExitCode::from(1)
            } else {
                ExitCode::SUCCESS
            }
        }
    }
}

fn q(s: &str) -> String {
    serde_json::Value::String(s.to_string()).to_string()
}
