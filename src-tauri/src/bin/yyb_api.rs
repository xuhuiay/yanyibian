/*! yyb-api：对外 HTTP 接口（给外部程序调用）。

用法（PowerShell）：
  $env:YYB_API_TOKEN="<随机串>"
  $env:YYB_AI_KEY="<模型服务 Key>"
  $env:YYB_AI_BASE="https://api.openai.com/v1"
  $env:YYB_AI_MODEL="gpt-4o-mini"
  .\yyb-api.exe

可选环境变量：
  YYB_API_ADDR=127.0.0.1:8788   YYB_API_RATE=30（每分钟请求数）
  YYB_API_ALLOW_ANON=1          显式允许不带 token（仅本机回环生效）
  YYB_API_ALLOW_REMOTE=1        显式允许监听非回环地址（默认只允许回环，且必须设 token）
  YYB_AI_PROVIDER=openai        YYB_AI_TIMEOUT_MS=20000   YYB_AI_RETRY=1
  YYB_AI_FACT_EDIT=1            允许模型改动数字（默认不允许）

安全说明：Key 只从环境变量读进进程内存，不写盘、不回显；日志只输出监听地址与限流参数。 */

use std::env;

use yanyibian_lib::ai;
use yanyibian_lib::api::{self, Options};

fn env_str(k: &str) -> Option<String> {
    env::var(k).ok().filter(|s| !s.trim().is_empty())
}

fn env_u64(k: &str) -> Option<u64> {
    env_str(k).and_then(|s| s.trim().parse::<u64>().ok())
}

fn env_u8(k: &str) -> Option<u8> {
    env_str(k).and_then(|s| s.trim().parse::<u8>().ok())
}

fn env_bool(k: &str) -> Option<bool> {
    env_str(k).map(|s| {
        let t = s.trim().to_lowercase();
        t == "1" || t == "true" || t == "yes"
    })
}

/// 判断监听地址是否落在本机回环（127.0.0.0/8、::1、localhost）。
fn is_loopback_addr(addr: &str) -> bool {
    if let Ok(sa) = addr.parse::<std::net::SocketAddr>() {
        return sa.ip().is_loopback();
    }
    let host = addr.rsplit_once(':').map(|(h, _)| h).unwrap_or(addr);
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost") || host == "::1"
}

fn main() {
    let addr = env_str("YYB_API_ADDR").unwrap_or_else(|| String::from("127.0.0.1:8788"));
    let token = env_str("YYB_API_TOKEN");
    let allow_anon = env_bool("YYB_API_ALLOW_ANON").unwrap_or(false);
    let allow_remote = env_bool("YYB_API_ALLOW_REMOTE").unwrap_or(false);
    let rate = env_u64("YYB_API_RATE").unwrap_or(30) as u32;

    if token.is_none() && !allow_anon {
        eprintln!("[yyb-api] 拒绝启动：未设置 YYB_API_TOKEN（也可显式设置 YYB_API_ALLOW_ANON=1 关闭鉴权，仅建议本机临时使用）");
        std::process::exit(2);
    }
    if !is_loopback_addr(&addr) {
        if !allow_remote {
            eprintln!("[yyb-api] 拒绝启动：默认只允许监听本机回环地址（127.0.0.1 / localhost / ::1）；确实需要对外监听时，显式设置 YYB_API_ALLOW_REMOTE=1，并先设置 YYB_API_TOKEN");
            std::process::exit(2);
        }
        if token.is_none() {
            eprintln!("[yyb-api] 拒绝启动：对外监听必须设置 YYB_API_TOKEN（YYB_API_ALLOW_ANON 只在本机回环生效）");
            std::process::exit(2);
        }
    }

    match env_str("YYB_AI_KEY") {
        Some(key) => {
            let provider = env_str("YYB_AI_PROVIDER").unwrap_or_else(|| String::from("custom"));
            let base = env_str("YYB_AI_BASE").unwrap_or_else(|| String::from("https://api.openai.com/v1"));
            let model = env_str("YYB_AI_MODEL").unwrap_or_default();
            let timeout = env_u64("YYB_AI_TIMEOUT_MS");
            let retry = env_u8("YYB_AI_RETRY");
            let fact = env_bool("YYB_AI_FACT_EDIT");
            match ai::configure_runtime(Some(provider), Some(base), Some(model), Some(key), timeout, retry, fact) {
                Ok(cfg) => {
                    println!("[yyb-api] AI 已就绪：model={} base={}", cfg["model"], cfg["baseUrl"]);
                }
                Err(e) => {
                    eprintln!("[yyb-api] 拒绝启动：AI 配置不合法：{e}");
                    std::process::exit(2);
                }
            }
        }
        None => {
            println!("[yyb-api] 未设置 YYB_AI_KEY：/v1/points 将只返回规则命中（ai.status=skipped）");
        }
    }

    let opts = Options { addr, token, rate_per_min: rate, allow_anon };
    if let Err(e) = api::serve(opts) {
        eprintln!("[yyb-api] {e}");
        std::process::exit(1);
    }
}
