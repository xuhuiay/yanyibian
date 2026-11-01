/*! AI 可选通道（方案 §10）：检查 → 修改 → 复检 → 交付。
   设计约束：
   1. 默认关闭；关闭时前后端都不发任何网络请求（命令直接返回 E_AI_OFF）。
   2. 密钥只存在进程内存里，不落盘、不写日志、不回显（ai_get_config 只回 has_key）。
   3. 判定仍由 C++ 内核做：AI 只产出「逐处替换」，改完必须重新跑内核复检。
   4. 数字/百分比/日期一律不许 AI 改：请求侧写进提示词，结果侧再做一次本地守卫。
   规则文档：docs/ai-api-rules.md */

use crate::core_ffi;
use crate::limits::{utf16_len, MAX_UNITS};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MIN_TIMEOUT_MS: u64 = 3_000;
const MAX_REVISIONS: usize = 20;
const MAX_BEFORE_CHARS: usize = 400;
const MAX_AFTER_CHARS: usize = 1_200;
const DEFAULT_BASE: &str = "https://api.openai.com/v1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// 总开关，默认 false
    pub enabled: bool,
    /// openai / deepseek / custom（仅用于界面展示与预设，不影响协议）
    pub provider: String,
    /// 形如 https://api.openai.com/v1（不带 /chat/completions）
    pub base_url: String,
    pub model: String,
    /// 是否允许 AI 改动数字/日期/百分比（默认 false，规则见 §10.4）
    #[serde(default)]
    pub allow_fact_edit: bool,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    /// 仅对网络错误 / 429 / 5xx 生效；4xx 不重试
    #[serde(default = "default_retry")]
    pub max_retry: u8,
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT_MS
}
fn default_retry() -> u8 {
    1
}

impl Default for AiConfig {
    fn default() -> Self {
        AiConfig {
            enabled: false,
            provider: String::from("openai"),
            base_url: String::from(DEFAULT_BASE),
            model: String::new(),
            allow_fact_edit: false,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            max_retry: 1,
        }
    }
}

fn cfg_lock() -> &'static Mutex<AiConfig> {
    static CFG: OnceLock<Mutex<AiConfig>> = OnceLock::new();
    CFG.get_or_init(|| Mutex::new(AiConfig::default()))
}

fn key_lock() -> &'static Mutex<Option<String>> {
    static KEY: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    KEY.get_or_init(|| Mutex::new(None))
}

fn cancel_flag() -> &'static AtomicBool {
    static C: AtomicBool = AtomicBool::new(false);
    &C
}

/* ---------------- 配置 ---------------- */

fn host_of(url: &str) -> String {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    let host = rest.split('/').next().unwrap_or("");
    host.split(':').next().unwrap_or("").to_ascii_lowercase()
}

fn is_local_host(h: &str) -> bool {
    h == "localhost" || h == "127.0.0.1" || h == "[::1]" || h == "::1"
}

/// 配置校验：所有拒绝都在这里发生，且每条文案都能对应到规则文档 §10.2。
pub fn validate(c: &AiConfig) -> Result<(), String> {
    let base = c.base_url.trim();
    if base.is_empty() {
        return Err(String::from("E_AI_CONFIG: base_url 不能为空"));
    }
    let https = base.starts_with("https://");
    let http = base.starts_with("http://");
    if !https && !(http && is_local_host(&host_of(base))) {
        return Err(String::from(
            "E_AI_CONFIG: base_url 必须是 https://（仅本机调试允许 http://localhost 或 http://127.0.0.1）",
        ));
    }
    if c.enabled && c.model.trim().is_empty() {
        return Err(String::from("E_AI_CONFIG: 启用时必须填写模型名"));
    }
    if c.timeout_ms < MIN_TIMEOUT_MS || c.timeout_ms > MAX_TIMEOUT_MS {
        return Err(format!(
            "E_AI_CONFIG: timeout_ms 必须在 {MIN_TIMEOUT_MS}..{MAX_TIMEOUT_MS} 之间"
        ));
    }
    if c.max_retry > 2 {
        return Err(String::from("E_AI_CONFIG: max_retry 最多 2 次"));
    }
    Ok(())
}

fn config_view() -> serde_json::Value {
    let c = cfg_lock().lock().unwrap().clone();
    let has_key = key_lock().lock().unwrap().is_some();
    serde_json::json!({
        "enabled": c.enabled,
        "provider": c.provider,
        "baseUrl": c.base_url,
        "model": c.model,
        "allowFactEdit": c.allow_fact_edit,
        "timeoutMs": c.timeout_ms,
        "maxRetry": c.max_retry,
        "hasKey": has_key,
        "maxUnits": MAX_UNITS,
    })
}

#[tauri::command]
pub fn ai_get_config() -> serde_json::Value {
    config_view()
}

/// 保存配置。api_key: None=不改动；Some("")=清除；Some(k)=替换。
/// 密钥只写内存，进程结束即丢失。
#[tauri::command]
pub fn ai_set_config(config: AiConfig, api_key: Option<String>) -> Result<serde_json::Value, String> {
    validate(&config)?;
    if let Some(k) = api_key {
        let mut slot = key_lock().lock().unwrap();
        if k.is_empty() {
            *slot = None;
        } else {
            *slot = Some(k);
        }
    }
    if config.enabled && key_lock().lock().unwrap().is_none() {
        return Err(String::from("E_AI_NO_KEY: 启用前请先填写 API Key"));
    }
    *cfg_lock().lock().unwrap() = config;
    Ok(config_view())
}

/// 供对外 API（`yyb-api`）复用：与 `ai_revise` 完全同一条链路
/// （内核校验 → 取缺陷 → 模型给最小改动 → 本地守卫 → 内核复检）。
pub fn revise_points_blocking(text: &str, template_id: &str) -> Result<serde_json::Value, String> {
    revise_blocking(text.to_string(), template_id.to_string())
}

/// 供对外 API 读取运行期配置快照（不含 Key 本身，只回 hasKey）。
pub fn config_snapshot() -> serde_json::Value {
    config_view()
}

/// 供对外 API 从环境变量装配配置。Key 只写入进程内存，调用方不得把它落盘。
pub fn configure_runtime(
    provider: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    timeout_ms: Option<u64>,
    max_retry: Option<u8>,
    allow_fact_edit: Option<bool>,
) -> Result<serde_json::Value, String> {
    let mut c = cfg_lock().lock().unwrap().clone();
    if let Some(p) = provider {
        if !p.is_empty() {
            c.provider = p;
        }
    }
    if let Some(b) = base_url {
        if !b.is_empty() {
            c.base_url = b;
        }
    }
    if let Some(m) = model {
        if !m.is_empty() {
            c.model = m;
        }
    }
    if let Some(t) = timeout_ms {
        c.timeout_ms = t;
    }
    if let Some(r) = max_retry {
        c.max_retry = r;
    }
    if let Some(f) = allow_fact_edit {
        c.allow_fact_edit = f;
    }
    c.enabled = true;
    validate(&c)?;
    if let Some(k) = api_key {
        let mut slot = key_lock().lock().unwrap();
        if k.is_empty() {
            *slot = None;
        } else {
            *slot = Some(k);
        }
    }
    if key_lock().lock().unwrap().is_none() {
        return Err(String::from("E_AI_NO_KEY: 启用前请先填写 API Key"));
    }
    *cfg_lock().lock().unwrap() = c;
    Ok(config_view())
}

#[tauri::command]
pub fn ai_cancel() -> bool {
    cancel_flag().store(true, Ordering::SeqCst);
    true
}

/* ---------------- 请求 ---------------- */

#[derive(Deserialize)]
struct RawRev {
    #[serde(default)]
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    before: String,
    #[serde(default)]
    after: String,
    #[serde(default)]
    reason: String,
}

#[derive(Deserialize)]
struct RawUnresolved {
    #[serde(default)]
    label: String,
    #[serde(default)]
    why: String,
}

#[derive(Deserialize)]
struct RawResp {
    #[serde(default)]
    revisions: Vec<RawRev>,
    #[serde(default)]
    unresolved: Vec<RawUnresolved>,
}

fn excerpt(s: &str) -> String {
    let t: String = s.chars().take(200).collect();
    t.replace('\n', " ")
}

fn strip_fence(s: &str) -> &str {
    let t = s.trim();
    if !t.starts_with(BT_CHAR) {
        return t;
    }
    let body_start = t.find('\n').map(|i| i + 1).unwrap_or(0);
    let body = &t[body_start..];
    match body.rfind(BT_CHAR) {
        Some(end) => &body[..end],
        None => body,
    }
}

const BT_CHAR: char = '\u{60}';

fn parse_content(content: &str) -> Result<RawResp, String> {
    let body = strip_fence(content);
    let body = match (body.find('{'), body.rfind('}')) {
        (Some(a), Some(b)) if b > a => &body[a..=b],
        _ => body,
    };
    serde_json::from_str::<RawResp>(body)
        .map_err(|e| format!("E_AI_BAD_JSON: 返回内容不是约定的 JSON（{e}）：{}", excerpt(content)))
}

fn build_prompt(template_id: &str, defects: &serde_json::Value, text: &str) -> (String, String) {
    let sys = [
        "你是中文交付稿的文字编辑。只按给出的缺陷清单做最小改动，不重写全文。",
        "硬规则：",
        "1) 不得改动任何数字、百分比、日期、金额、人名、机构名、引用原文；需要改这些才能修的，放进 unresolved。",
        "2) 不得新增原文没有的事实、数据、案例、结论。",
        "3) 每条改动是一个「在原文中只出现一次的连续片段」的替换；before 必须与原文逐字相同（含标点）。",
        "4) 只输出一个 JSON 对象，不要 markdown 代码块，不要任何前后说明。",
        "5) 格式：{\"revisions\":[{\"type\":\"缺陷类型\",\"before\":\"原文片段\",\"after\":\"替换后\",\"reason\":\"一句话理由\"}],\"unresolved\":[{\"label\":\"缺陷标签\",\"why\":\"为什么不能自动改\"}]}",
        "6) 最多 20 条改动；before 不超过 200 字，after 不超过 400 字；没有可改的就返回空数组。",
    ]
    .join("\n");

    let mut user = String::new();
    user.push_str("模板：");
    user.push_str(template_id);
    user.push_str("\n\n缺陷清单：\n");
    if let Some(list) = defects.as_array() {
        for (i, d) in list.iter().enumerate() {
            let sev = d["sev"].as_str().unwrap_or("");
            let label = d["label"].as_str().unwrap_or("");
            let kind = d["type"].as_str().unwrap_or("");
            let explain = d["explain"].as_str().unwrap_or("");
            let (a, b) = (
                d["start"].as_i64().unwrap_or(-1),
                d["end"].as_i64().unwrap_or(-1),
            );
            user.push_str(&format!("{}. [{sev}] {label}（{kind}）：{explain}", i + 1));
            if a >= 0 && b > a {
                let quote: String = text
                    .chars()
                    .skip(a as usize)
                    .take((b - a) as usize)
                    .collect();
                user.push_str(&format!(" ｜原文片段：「{quote}」"));
            }
            user.push('\n');
        }
    }
    user.push_str("\n正文（只读参考，不要整体复述）：\n<<<\n");
    user.push_str(text);
    user.push_str("\n>>>\n");
    (sys, user)
}

struct ChatOut {
    content: String,
    usage: serde_json::Value,
    attempts: u8,
}

fn chat(cfg: &AiConfig, key: &str, sys: &str, user: &str) -> Result<ChatOut, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(cfg.timeout_ms))
        .connect_timeout(Duration::from_millis(5_000.min(cfg.timeout_ms)))
        .user_agent("yanyibian-desktop/0.2")
        .build()
        .map_err(|e| format!("E_AI_NET: 无法初始化 HTTP 客户端（{e}）"))?;

    let url = format!(
        "{}/chat/completions",
        cfg.base_url.trim().trim_end_matches('/')
    );
    let body = serde_json::json!({
        "model": cfg.model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": user}
        ],
        "response_format": {"type": "json_object"}
    });

    let mut last: String = String::from("E_AI_NET: 未知错误");
    for attempt in 0..=cfg.max_retry {
        if cancel_flag().load(Ordering::SeqCst) {
            return Err(String::from("E_AI_CANCELLED: 已取消"));
        }
        let sent = client
            .post(&url)
            .header("authorization", format!("Bearer {key}"))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send();
        match sent {
            Ok(resp) => {
                if cancel_flag().load(Ordering::SeqCst) {
                    return Err(String::from("E_AI_CANCELLED: 已取消（结果已丢弃）"));
                }
                let status = resp.status();
                let raw = resp.text().unwrap_or_default();
                if status.is_success() {
                    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
                        format!("E_AI_BAD_JSON: 响应不是 JSON（{e}）：{}", excerpt(&raw))
                    })?;
                    let content = v["choices"][0]["message"]["content"]
                        .as_str()
                        .ok_or_else(|| {
                            format!(
                                "E_AI_BAD_JSON: 响应缺少 choices[0].message.content：{}",
                                excerpt(&raw)
                            )
                        })?
                        .to_string();
                    let usage = v.get("usage").cloned().unwrap_or(serde_json::json!({}));
                    return Ok(ChatOut {
                        content,
                        usage,
                        attempts: attempt + 1,
                    });
                }
                let code = status.as_u16();
                let msg = format!("E_AI_HTTP_{code}: {}", excerpt(&raw));
                let retryable = code == 429 || status.is_server_error();
                if !retryable || attempt == cfg.max_retry {
                    return Err(msg);
                }
                last = msg;
            }
            Err(e) => {
                let msg = if e.is_timeout() {
                    format!("E_AI_TIMEOUT: 超过 {} ms 未返回", cfg.timeout_ms)
                } else if e.is_connect() {
                    format!("E_AI_CONNECT: 连不上 {url}（{e}）")
                } else {
                    format!("E_AI_NET: {e}")
                };
                if attempt == cfg.max_retry {
                    return Err(msg);
                }
                last = msg;
            }
        }
        std::thread::sleep(Duration::from_millis(400 * (attempt as u64 + 1)));
    }
    Err(last)
}

/* ---------------- 本地守卫：把 AI 的替换逐条落到原文 ---------------- */

#[derive(Serialize)]
struct Applied {
    index: usize,
    kind: String,
    before: String,
    after: String,
    reason: String,
    /// 在修改稿中的区间（UTF-16 码元，与内核 chars 同口径）
    start: usize,
    end: usize,
}

#[derive(Serialize)]
struct Rejected {
    kind: String,
    before: String,
    reason: String,
}

fn digits_of(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() {
            out.push(c);
        } else if ('０'..='９').contains(&c) {
            let d = (c as u32 - '０' as u32) as u8 + b'0';
            out.push(d as char);
        }
    }
    out
}

/// 应用替换：每条 before 必须在原文中唯一出现；数字被改的整条拒绝（allow_fact=false）。
fn apply_revisions(
    original: &str,
    revs: Vec<RawRev>,
    allow_fact: bool,
) -> (String, Vec<Applied>, Vec<Rejected>) {
    struct Plan {
        pos: usize,
        after: String,
        kind: String,
        before: String,
        reason: String,
    }
    let mut plans: Vec<Plan> = Vec::new();
    let mut rejected: Vec<Rejected> = Vec::new();
    let mut seen: Vec<(usize, usize)> = Vec::new();

    for (i, r) in revs.into_iter().enumerate() {
        if i >= MAX_REVISIONS {
            break;
        }
        let kind = if r.kind.is_empty() {
            String::from("未标注")
        } else {
            r.kind.clone()
        };
        if r.before.is_empty() || r.before == r.after {
            rejected.push(Rejected {
                kind,
                before: r.before,
                reason: String::from("空改动或前后相同"),
            });
            continue;
        }
        if r.before.chars().count() > MAX_BEFORE_CHARS
            || r.after.chars().count() > MAX_AFTER_CHARS
        {
            rejected.push(Rejected {
                kind,
                before: r.before,
                reason: String::from("片段过长（before>400 或 after>1200 字符）"),
            });
            continue;
        }
        if !allow_fact && digits_of(&r.before) != digits_of(&r.after) {
            rejected.push(Rejected {
                kind,
                before: r.before,
                reason: String::from("改动涉及数字/百分比/日期，按规则拦下（如需允许请打开 allowFactEdit）"),
            });
            continue;
        }
        let hits: Vec<usize> = original.match_indices(&r.before).map(|(p, _)| p).collect();
        if hits.len() != 1 {
            rejected.push(Rejected {
                kind,
                before: r.before,
                reason: if hits.is_empty() {
                    String::from("原文中找不到该片段")
                } else {
                    String::from("该片段在原文中出现多次，无法唯一替换")
                },
            });
            continue;
        }
        let pos = hits[0];
        if seen.iter().any(|(a, b)| pos < *b && *a < pos + r.before.len()) {
            rejected.push(Rejected {
                kind,
                before: r.before,
                reason: String::from("与另一处改动区间重叠"),
            });
            continue;
        }
        seen.push((pos, pos + r.before.len()));
        plans.push(Plan {
            pos,
            after: r.after,
            kind,
            before: r.before,
            reason: r.reason,
        });
    }

    plans.sort_by_key(|p| p.pos);
    let mut out = String::new();
    let mut cursor = 0usize;
    let mut applied: Vec<Applied> = Vec::new();
    for (i, p) in plans.iter().enumerate() {
        out.push_str(&original[cursor..p.pos]);
        let start = utf16_len(&out);
        out.push_str(&p.after);
        applied.push(Applied {
            index: i + 1,
            kind: p.kind.clone(),
            before: p.before.clone(),
            after: p.after.clone(),
            reason: p.reason.clone(),
            start,
            end: start + utf16_len(&p.after),
        });
        cursor = p.pos + p.before.len();
    }
    out.push_str(&original[cursor..]);
    (out, applied, rejected)
}

/* ---------------- 复检与交付 ---------------- */

fn summary_of(v: &serde_json::Value) -> serde_json::Value {
    let labels: Vec<String> = v["defects"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|d| d["label"].as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default();
    serde_json::json!({
        "verdict": v["verdict"]["text"],
        "why": v["verdict"]["why"],
        "high": v["verdict"]["high"],
        "mid": v["verdict"]["mid"],
        "low": v["verdict"]["low"],
        "chars": v["chars"],
        "defects": labels,
    })
}

fn revise_blocking(text: String, template_id: String) -> Result<serde_json::Value, String> {
    cancel_flag().store(false, Ordering::SeqCst);
    let cfg = cfg_lock().lock().unwrap().clone();
    if !cfg.enabled {
        return Err(String::from(
            "E_AI_OFF: AI 通道已关闭（在「AI 修改」面板里打开开关并保存设置后可用）",
        ));
    }
    validate(&cfg)?;
    let key = key_lock()
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| String::from("E_AI_NO_KEY: 未填写 API Key"))?;

    let n = utf16_len(&text);
    if n > MAX_UNITS {
        return Err(crate::limits::too_long(n));
    }
    let before = core_ffi::check(&text, &template_id)?;
    let defects = before["defects"].clone();
    if defects.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        return Err(String::from(
            "E_AI_NOTHING_TO_FIX: 当前没有需要修改的缺陷，不需要调用 AI",
        ));
    }

    let (sys, user) = build_prompt(&template_id, &defects, &text);
    let started = Instant::now();
    let out = chat(&cfg, &key, &sys, &user)?;
    let parsed = parse_content(&out.content)?;
    let mut unresolved: Vec<serde_json::Value> = parsed
        .unresolved
        .iter()
        .map(|u| serde_json::json!({"label": u.label, "why": u.why}))
        .collect();

    let (mut revised, mut applied, mut rejected) =
        apply_revisions(&text, parsed.revisions, cfg.allow_fact_edit);

    // 长度守卫：超过上限就按倒序丢弃改动，直到放得下（丢掉的逐条记进 rejected）
    while utf16_len(&revised) > MAX_UNITS && !applied.is_empty() {
        let last = applied.pop().unwrap();
        rejected.push(Rejected {
            kind: last.kind.clone(),
            before: last.before.clone(),
            reason: format!("会让正文超过 {MAX_UNITS} 字上限，已丢弃"),
        });
        let remaining: Vec<RawRev> = applied
            .iter()
            .map(|a| RawRev {
                kind: a.kind.clone(),
                before: a.before.clone(),
                after: a.after.clone(),
                reason: a.reason.clone(),
            })
            .collect();
        let again = apply_revisions(&text, remaining, cfg.allow_fact_edit);
        revised = again.0;
        applied = again.1;
    }

    let after = core_ffi::check(&revised, &template_id)?;
    let before_sum = summary_of(&before);
    let after_sum = summary_of(&after);
    let before_labels: Vec<String> = before_sum["defects"]
        .as_array()
        .map(|a| a.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect())
        .unwrap_or_default();
    let after_labels: Vec<String> = after_sum["defects"]
        .as_array()
        .map(|a| a.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect())
        .unwrap_or_default();
    let resolved: Vec<String> = before_labels
        .iter()
        .filter(|l| !after_labels.contains(l))
        .cloned()
        .collect();
    let remaining: Vec<String> = after_labels.clone();

    if applied.is_empty() {
        unresolved.push(serde_json::json!({
            "label": "全部缺陷",
            "why": "AI 没有给出可安全落地的最小改动（或全部被本地守卫拦下），请人工修改"
        }));
    }

    Ok(serde_json::json!({
        "ok": true,
        "provider": cfg.provider,
        "model": cfg.model,
        "elapsedMs": started.elapsed().as_millis() as u64,
        "attempts": out.attempts,
        "usage": out.usage,
        "maxUnits": MAX_UNITS,
        "revisedText": revised,
        "changes": applied,
        "rejected": rejected,
        "unresolved": unresolved,
        "review": {
            "before": before_sum,
            "after": after_sum,
            "resolved": resolved,
            "remaining": remaining,
        }
    }))
}

/// 检查 → 让 AI 给最小改动 → 本地守卫落地 → 内核复检 → 返回可导出的交付包数据。
#[tauri::command]
pub async fn ai_revise(text: String, template_id: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || revise_blocking(text, template_id))
        .await
        .map_err(|e| format!("E_AI_INTERNAL: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digits_guard_blocks_number_edits() {
        let revs = vec![RawRev {
            kind: String::from("事实一致性"),
            before: String::from("提升 40%"),
            after: String::from("提升 45%"),
            reason: String::new(),
        }];
        let (_t, applied, rejected) = apply_revisions("效率提升 40%，继续。", revs, false);
        assert!(applied.is_empty());
        assert_eq!(rejected.len(), 1);
    }

    #[test]
    fn unique_match_and_offset() {
        let revs = vec![RawRev {
            kind: String::from("禁用项"),
            before: String::from("赋能"),
            after: String::from("支持"),
            reason: String::new(),
        }];
        let (t, applied, rejected) = apply_revisions("全面赋能实验。", revs, false);
        assert_eq!(t, "全面支持实验。");
        assert_eq!(applied[0].start, 2);
        assert!(rejected.is_empty());
    }

    #[test]
    fn duplicate_snippet_is_rejected() {
        let revs = vec![RawRev {
            kind: String::from("x"),
            before: String::from("提升"),
            after: String::from("提高"),
            reason: String::new(),
        }];
        let (_t, applied, rejected) = apply_revisions("提升效率，提升质量。", revs, false);
        assert!(applied.is_empty());
        assert_eq!(rejected.len(), 1);
    }
}
