/*! 对外 HTTP API（给外部程序调用，不依赖壳页）。
   只做两件事：把「文本 + 模板」交给既有 AI 通道，再把结果整理成可修改点列表。
   判定仍由 C++ 内核完成，模型只提供改法；两者在响应里用 source 区分。
   安全默认：只监听 127.0.0.1，必须带 Bearer token，按分钟限流；Key 只读环境变量进内存。 */

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::{ai, core_ffi, limits};

pub const API_VERSION: &str = "1";
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_BODY_BYTES: usize = 512 * 1024;
/// 超限请求体最多再读掉这么多字节（只是为了体面地回 413，不缓存）
const MAX_DRAIN_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone)]
pub struct Options {
    pub addr: String,
    pub token: Option<String>,
    pub rate_per_min: u32,
    pub allow_anon: bool,
}

static RATE: Mutex<(u64, u32)> = Mutex::new((0, 0));
static SEQ: AtomicU64 = AtomicU64::new(0);

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

pub fn serve(opts: Options) -> Result<(), String> {
    let listener = TcpListener::bind(opts.addr.as_str())
        .map_err(|e| format!("E_API_BIND: 无法监听 {}：{e}", opts.addr))?;
    println!(
        "[yyb-api] listening on http://{} (rate {} req/min, allow_anon={})",
        opts.addr, opts.rate_per_min, opts.allow_anon
    );
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let o = opts.clone();
                std::thread::spawn(move || handle_conn(stream, o));
            }
            Err(e) => eprintln!("[yyb-api] accept failed: {e}"),
        }
    }
    Ok(())
}

fn handle_conn(mut stream: TcpStream, opts: Options) {
    let req = match read_request(&mut stream) {
        Ok(r) => r,
        Err(e) => {
            let code = first_token(&e);
            let status: u16 = if code == "E_API_TOO_LARGE" { 413 } else { 400 };
            respond(&mut stream, status, &err_body(&code, &e));
            return;
        }
    };
    if !rate_ok(opts.rate_per_min) {
        respond(&mut stream, 429, &err_body("E_API_RATE_LIMITED", "请求过于频繁，请稍后再试"));
        return;
    }
    if !authorized(&req, &opts) {
        respond(&mut stream, 401, &err_body("E_API_UNAUTHORIZED", "缺少或错误的 Authorization: Bearer <token>"));
        return;
    }
    let (status, body) = match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/v1/health") => (200, health_body()),
        ("POST", "/v1/points") => handle_points(&req),
        ("GET", "/v1/points") => (405, err_body("E_API_METHOD", "请用 POST /v1/points")),
        ("POST", "/v1/health") => (405, err_body("E_API_METHOD", "健康检查请用 GET /v1/health")),
        _ => (404, err_body("E_API_NOT_FOUND", "可用端点：GET /v1/health、POST /v1/points")),
    };
    respond(&mut stream, status, &body);
}

fn health_body() -> Value {
    json!({
        "ok": true,
        "apiVersion": API_VERSION,
        "ruleVersion": core_ffi::rule_version(),
        "ai": ai::config_snapshot(),
        "limits": { "maxUnits": limits::MAX_UNITS, "maxBodyBytes": MAX_BODY_BYTES }
    })
}

fn handle_points(req: &Request) -> (u16, Value) {
    let parsed: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(e) => return (400, err_body("E_API_BAD_JSON", &format!("请求体不是合法 JSON：{e}"))),
    };
    let text = match parsed.get("text").and_then(|v| v.as_str()) {
        Some(t) if !t.trim().is_empty() => t.to_string(),
        _ => return (400, err_body("E_API_NO_TEXT", "缺少 text 字段，或 text 只有空白")),
    };
    let tpl = parsed
        .get("templateId")
        .and_then(|v| v.as_str())
        .unwrap_or("general")
        .to_string();
    let include_rules = parsed
        .get("includeRules")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let max_points = parsed
        .get("maxPoints")
        .and_then(|v| v.as_u64())
        .unwrap_or(20) as usize;

    let n = limits::utf16_len(&text);
    if n > limits::MAX_UNITS {
        return (413, err_body("E_TOO_LARGE", &limits::too_long(n)));
    }

    let rule = match core_ffi::check(&text, &tpl) {
        Ok(v) => v,
        Err(_) => {
            return (
                400,
                err_body("E_TEMPLATE", "templateId 非法；可用 weekly / notice / readme / general / agentcmd"),
            )
        }
    };

    let started = Instant::now();
    let mut ai_status = String::from("ok");
    let mut ai_note = Value::Null;
    let mut changes: Vec<Value> = Vec::new();
    let mut unresolved: Vec<Value> = Vec::new();
    let mut rejected: Vec<Value> = Vec::new();
    let mut review = Value::Null;
    let mut meta = Value::Null;

    match ai::revise_points_blocking(&text, &tpl) {
        Ok(v) => {
            changes = v.get("changes").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            unresolved = v.get("unresolved").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            rejected = v.get("rejected").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            review = v.get("review").cloned().unwrap_or(Value::Null);
            meta = json!({
                "provider": v.get("provider").cloned().unwrap_or(Value::Null),
                "model": v.get("model").cloned().unwrap_or(Value::Null),
                "attempts": v.get("attempts").cloned().unwrap_or(Value::Null),
                "usage": v.get("usage").cloned().unwrap_or(Value::Null),
            });
        }
        Err(e) => {
            let code = first_token(&e);
            if code == "E_AI_OFF" || code == "E_AI_NO_KEY" || code == "E_AI_NOTHING_TO_FIX" {
                ai_status = String::from("skipped");
                ai_note = json!({ "code": code, "message": strip_code(&code, &e) });
            } else {
                let status: u16 = match code.as_str() {
                    "E_AI_TIMEOUT" => 504,
                    "E_TOO_LARGE" => 413,
                    "E_AI_CONFIG" | "E_TEMPLATE" => 400,
                    _ => 502,
                };
                return (status, err_body(&code, &e));
            }
        }
    }

    let mut points: Vec<Value> = Vec::new();
    let mut seq = 0usize;
    for c in changes.iter() {
        if points.len() >= max_points {
            break;
        }
        seq += 1;
        points.push(json!({
            "id": format!("ai-{seq}"),
            "source": "ai",
            "type": c.get("kind").cloned().unwrap_or(Value::Null),
            "rule": Value::Null,
            "before": c.get("before").cloned().unwrap_or(Value::Null),
            "suggestion": c.get("after").cloned().unwrap_or(Value::Null),
            "reason": c.get("reason").cloned().unwrap_or(Value::Null),
            "start": c.get("start").cloned().unwrap_or(Value::Null),
            "end": c.get("end").cloned().unwrap_or(Value::Null),
            "severity": "suggestion"
        }));
    }
    if include_rules {
        let defects = rule.get("defects").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        for d in defects.iter() {
            if points.len() >= max_points {
                break;
            }
            seq += 1;
            let start = d.get("start").and_then(|v| v.as_i64()).unwrap_or(-1);
            let end = d.get("end").and_then(|v| v.as_i64()).unwrap_or(-1);
            points.push(json!({
                "id": format!("rule-{seq}"),
                "source": "rule",
                "type": d.get("type").cloned().unwrap_or(Value::Null),
                "rule": d.get("label").cloned().unwrap_or(Value::Null),
                "before": slice_u16(&text, start, end),
                "suggestion": Value::Null,
                "reason": d.get("explain").cloned().unwrap_or(Value::Null),
                "start": start,
                "end": end,
                "severity": d.get("sev").cloned().unwrap_or(Value::Null)
            }));
        }
    }

    let body = json!({
        "ok": true,
        "apiVersion": API_VERSION,
        "requestId": next_request_id(),
        "ruleVersion": core_ffi::rule_version(),
        "templateId": tpl,
        "elapsedMs": started.elapsed().as_millis() as u64,
        "points": points,
        "unresolved": unresolved,
        "rejected": rejected,
        "review": review,
        "ai": { "status": ai_status, "note": ai_note, "meta": meta },
        "verdict": rule.get("verdict").cloned().unwrap_or(Value::Null),
        "limits": { "maxUnits": limits::MAX_UNITS }
    });
    (200, body)
}

fn slice_u16(text: &str, start: i64, end: i64) -> Value {
    if start < 0 || end <= start {
        return Value::Null;
    }
    let (s, e) = (start as usize, end as usize);
    let mut out = String::new();
    let mut i = 0usize;
    for ch in text.chars() {
        let w = ch.len_utf16();
        if i >= s && i + w <= e {
            out.push(ch);
        }
        i += w;
        if i >= e {
            break;
        }
    }
    if out.is_empty() { Value::Null } else { json!(out) }
}

fn next_request_id() -> String {
    let n = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("req-{ms}-{n}")
}

fn first_token(e: &str) -> String {
    e.split(":").next().unwrap_or("E_API").trim().to_string()
}

fn rate_ok(per_min: u32) -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut g = RATE.lock().unwrap();
    if now.saturating_sub(g.0) >= 60 {
        *g = (now, 1);
        return true;
    }
    if g.1 >= per_min {
        return false;
    }
    g.1 += 1;
    true
}

fn authorized(req: &Request, opts: &Options) -> bool {
    let need = match opts.token.as_ref() {
        Some(t) if !t.is_empty() => t.clone(),
        _ => return opts.allow_anon,
    };
    for (k, v) in req.headers.iter() {
        if k == "authorization" {
            let vv = v.trim();
            if let Some(rest) = vv.strip_prefix("Bearer ") {
                return rest.trim() == need;
            }
            if let Some(rest) = vv.strip_prefix("bearer ") {
                return rest.trim() == need;
            }
            return vv == need;
        }
    }
    false
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    if buf.len() < 4 {
        return None;
    }
    let mut i = 0usize;
    while i + 3 < buf.len() {
        if buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10 {
            return Some(i + 4);
        }
        i += 1;
    }
    None
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 8192];
    let header_end = loop {
        if let Some(p) = find_header_end(&buf) {
            break p;
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Err(String::from("E_API_BAD_REQUEST: 请求头过大"));
        }
        let n = stream
            .read(&mut tmp)
            .map_err(|e| format!("E_API_IO: 读取请求失败：{e}"))?;
        if n == 0 {
            return Err(String::from("E_API_BAD_REQUEST: 空请求"));
        }
        buf.extend_from_slice(&tmp[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_uppercase();
    let raw_path = parts.next().unwrap_or("/");
    let path = raw_path.split("?").next().unwrap_or("/").to_string();
    let mut headers: Vec<(String, String)> = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some(i) = line.find(": ") {
            headers.push((line[..i].to_lowercase(), line[i + 2..].trim().to_string()));
        }
    }
    let mut len = 0usize;
    for (k, v) in headers.iter() {
        if k == "content-length" {
            len = v.parse::<usize>().unwrap_or(0);
        }
    }
    if len > MAX_BODY_BYTES {
        // 已经决定拒绝，但要把声明的请求体读掉（有上限）再返回，
        // 否则半路关连接会让对方收到 ECONNRESET、连 413 都看不到。
        let mut left = len.min(MAX_DRAIN_BYTES);
        let mut sink = [0u8; 8192];
        while left > 0 {
            let want = left.min(sink.len());
            match stream.read(&mut sink[..want]) {
                Ok(0) => break,
                Ok(n) => left -= n,
                Err(_) => break,
            }
        }
        return Err(String::from("E_API_TOO_LARGE: 请求体超过 512 KB"));
    }
    let mut body = buf[header_end..].to_vec();
    while body.len() < len {
        let n = stream
            .read(&mut tmp)
            .map_err(|e| format!("E_API_IO: 读取请求体失败：{e}"))?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    body.truncate(len);
    Ok(Request { method, path, headers, body })
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Unknown",
    }
}

/// 错误码已经单独返回，去掉消息里重复的 "E_XXX: " 前缀，避免调用方看到两遍。
fn strip_code<'a>(code: &str, msg: &'a str) -> &'a str {
    let m = msg.trim();
    if let Some(rest) = m.strip_prefix(code) {
        if let Some(rest2) = rest.strip_prefix(':') {
            return rest2.trim();
        }
    }
    m
}

fn err_body(code: &str, msg: &str) -> Value {
    json!({ "ok": false, "apiVersion": API_VERSION, "error": { "code": code, "message": strip_code(code, msg) } })
}

fn respond(stream: &mut TcpStream, status: u16, body: &Value) {
    let text = serde_json::to_string(body).unwrap_or_else(|_| String::from("{}"));
    let head = format!(
        "HTTP/1.1 {status} {}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\ncache-control: no-store\r\n\r\n",
        reason_phrase(status),
        text.as_bytes().len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(text.as_bytes());
    let _ = stream.flush();
}