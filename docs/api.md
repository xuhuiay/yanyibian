# 验一遍 · 对外 HTTP API（yyb-api）v1.9

面向**外部程序**的接口：传入一段要交付的文本，返回「可修改点」清单（哪里改、改成什么、为什么改）＋规则判定结论＋可选的大模型改写建议。
判定内核与壳页共用同一份 C++ 内核（`RULE_VERSION = yyb-4`），模型调用复用 `src-tauri/src/ai.rs` 的既有通道，**没有第二套实现**。

---

## 1. 定位与边界

| 维度 | 说明 |
| --- | --- |
| 它是什么 | 一个独立可执行文件 `yyb-api.exe`（与 GUI、`yyb-check` 同一个 Cargo 包），只提供 HTTP 服务，不建窗口、不碰 WebView |
| 判定谁做 | 规则判定 100% 由 C++ 内核给出（与 GUI/CLI/Web 逐键一致）；模型只负责「怎么改」 |
| 模型输出算不算判定 | **不算**。响应里 `points` 按 `source: "ai" | "rule"` 分开标注，`verdict` 始终来自规则内核 |
| 文本会不会外发 | 只有开启 AI 且配置了 Key 时才把**正文 + 模板 + 已命中缺陷**发给模型服务；`ai.status="skipped"` 时零外联 |
| 写不写盘 | 不写。Key 只在进程内存（`Mutex<Option<String>>`），无日志、无缓存、无历史 |
| 传输 | 明文 HTTP/1.1（`connection: close`，一次连接一个请求）。无 TLS、无 keep-alive |

---

## 2. 启动

```powershell
$env:YYB_API_TOKEN="<随机串>"          # 必填，除非显式 YYB_API_ALLOW_ANON=1
$env:YYB_AI_KEY="<模型服务 Key>"       # 选填；不填则只返回规则命中
$env:YYB_AI_BASE="https://api.openai.com/v1"
$env:YYB_AI_MODEL="gpt-4o-mini"
.\yyb-api.exe
```

启动后打印：

```
[yyb-api] AI 已就绪：model="mock-model" base="http://127.0.0.1:8799/v1"
[yyb-api] listening on http://127.0.0.1:8788 (rate 60 req/min, allow_anon=false)
```

### 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `YYB_API_ADDR` | `127.0.0.1:8788` | 监听地址 |
| `YYB_API_TOKEN` | 无 | 鉴权 token；未设且未开 `ALLOW_ANON` 时**拒绝启动**（exit 2） |
| `YYB_API_ALLOW_ANON` | `false` | `1/true/yes` 时允许无 token（**只对回环监听生效**） |
| `YYB_API_ALLOW_REMOTE` | `false` | `1/true/yes` 时允许监听非回环地址（仍必须设 token，否则拒绝启动） |
| `YYB_API_RATE` | `30` | 每分钟请求上限（全局固定窗口，不按 token 分桶） |
| `YYB_AI_PROVIDER` | `custom` | 仅作文档标记，随响应返回 |
| `YYB_AI_BASE` | `https://api.openai.com/v1` | OpenAI 兼容 base_url；**明文 http 只允许 localhost/127.0.0.1/[::1]** |
| `YYB_AI_MODEL` | 空 | 必填，否则拒绝启动 |
| `YYB_AI_KEY` | 无 | 只读进内存 |
| `YYB_AI_TIMEOUT_MS` | `20000` | 3000–120000 |
| `YYB_AI_RETRY` | `1` | 0–2，仅对网络错误 / 429 / 5xx 重试 |
| `YYB_AI_FACT_EDIT` | `false` | 允许模型改数字（默认拦截） |

拒绝启动的三种情况：①没有 token 又没开匿名；②监听非本机地址且没有 token；③AI 配置不合法（如 base_url 不是 https 且不是本机、模型为空、超时越界）。

---

## 3. 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/v1/health` | 探活 + 读出当前规则版本、AI 配置（不含 Key）、上限 |
| POST | `/v1/points` | 主接口：文本 → 可修改点 |
| 其它 | 任意 | 404 `E_API_NOT_FOUND`；已注册路径用错方法 → 405 `E_API_METHOD` |

处理顺序：读请求 → **限流**（429）→ **鉴权**（401）→ 路由。因此并发过猛时可能先看到 429 而不是 401。

### GET /v1/health

```bash
curl -H "Authorization: Bearer tok-abc" http://127.0.0.1:8788/v1/health
```

```json
{
  "ok": true,
  "apiVersion": "1",
  "ruleVersion": "yyb-4",
  "ai": {
    "enabled": true, "hasKey": true, "provider": "custom",
    "baseUrl": "http://127.0.0.1:8799/v1", "model": "mock-model",
    "allowFactEdit": false, "timeoutMs": 20000, "maxRetry": 1, "maxUnits": 20000
  },
  "limits": { "maxUnits": 20000, "maxBodyBytes": 524288 }
}
```

`ai.enabled=false` 时 `/v1/points` 仍可用，只是只返回规则命中。

---

## 4. POST /v1/points

### 请求

```json
{
  "text": "要交付的正文",
  "templateId": "weekly",
  "includeRules": true,
  "maxPoints": 20
}
```

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `text` | string | 是 | — | 正文；全空白视为缺失（`E_API_NO_TEXT`）；超过 20000 个 UTF-16 码元 → 413 `E_TOO_LARGE` |
| `templateId` | string | 否 | `general` | `weekly` / `notice` / `readme` / `general` / `agentcmd`；其它值 → 400 `E_TEMPLATE` |
| `includeRules` | bool | 否 | `true` | 是否把规则命中放进 `points`（不影响 `verdict` / `review`） |
| `maxPoints` | number | 否 | `20` | `points` 上限；AI 点在前，规则点在后，超出的丢弃 |

必须带 `Content-Length`（不支持 `Transfer-Encoding: chunked`）；请求体 > 512 KB → 413 `E_API_TOO_LARGE`（服务端会先把超限体读掉再回，避免客户端只看到 ECONNRESET）。

### 响应（真实抓包，`templateId=weekly` + 78 字示例文本）

```json
{
  "ok": true,
  "apiVersion": "1",
  "requestId": "req-1793539525318-3",
  "ruleVersion": "yyb-4",
  "templateId": "weekly",
  "elapsedMs": 2,
  "points": [
    {
      "id": "ai-1", "source": "ai", "type": "禁用项", "rule": null,
      "before": "赋能", "suggestion": "支持", "reason": "把套话换成中性词",
      "start": 67, "end": 69, "severity": "suggestion"
    },
    {
      "id": "rule-2", "source": "rule", "type": "要素覆盖", "rule": "缺「风险」",
      "before": null, "suggestion": null,
      "reason": "全文没有找到表示「风险」的内容。这一项没有可标注的原句，请自己补一段，不要用别的段落顶替。",
      "start": -1, "end": -1, "severity": "high"
    },
    {
      "id": "rule-3", "source": "rule", "type": "禁用项", "rule": "套话「赋能」",
      "before": "赋能", "suggestion": null,
      "reason": "换成具体做了什么、得到什么结果。套话在这里只占字数，不传递信息。",
      "start": 67, "end": 69, "severity": "mid"
    },
    {
      "id": "rule-4", "source": "rule", "type": "事实一致性", "rule": "量化断言 2 处",
      "before": "提升 4", "suggestion": null,
      "reason": "出现具体数字（如「提升 4」）但没有出处。交付前补一句口径：谁测的、样本多少、什么条件下。",
      "start": 19, "end": 23, "severity": "mid"
    }
  ],
  "unresolved": [ { "label": "量化断言 2 处", "why": "涉及数据，按规则不自动改" } ],
  "rejected": [],
  "review": {
    "before": { "verdict": "不建议直接交付", "why": "有 1 处需要先补内容，补完再交。", "high": 1, "mid": 2, "low": 0, "chars": 78,
                "defects": ["缺「风险」", "套话「赋能」", "量化断言 2 处"] },
    "after":  { "verdict": "不建议直接交付", "why": "有 1 处需要先补内容，补完再交。", "high": 1, "mid": 1, "low": 0, "chars": 78,
                "defects": ["缺「风险」", "量化断言 2 处"] },
    "resolved": ["套话「赋能」"],
    "remaining": ["缺「风险」", "量化断言 2 处"]
  },
  "ai": {
    "status": "ok", "note": null,
    "meta": { "provider": "custom", "model": "mock-model", "attempts": 1,
              "usage": { "prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150 } }
  },
  "verdict": { "text": "不建议直接交付", "why": "有 1 处需要先补内容，补完再交。", "cls": "is-bad", "high": 1, "mid": 2, "low": 0 },
  "limits": { "maxUnits": 20000 }
}
```

### 字段语义

| 字段 | 语义 |
| --- | --- |
| `points[].source` | `"ai"` 模型建议；`"rule"` 规则命中 |
| `points[].type` | 缺陷类别：`要素覆盖` / `禁用项` / `格式` / `事实一致性` |
| `points[].rule` | 仅 `source="rule"`：命中的规则标签（如 `套话「赋能」`）；AI 点为 `null` |
| `points[].before` | 原文片段；规则点按 `start/end` 从 `text` 切出，区间为 `-1`（无可标注原句）时为 `null` |
| `points[].suggestion` | 仅 AI 点：**可直接替换 `before` 的改后文本**；规则点为 `null`（规则只指出问题，不给改法） |
| `points[].reason` | 为什么要改（AI 点来自模型，规则点来自内核 `explain`） |
| `points[].start`/`end` | **UTF-16 码元**区间，左闭右开；`-1` 表示无可标注位置。调用方按同一口径切片即可 |
| `points[].severity` | AI 点固定 `"suggestion"`；规则点 `high` / `mid` / `low` |
| `unresolved` | 需要人工处理的缺陷（AI 明确表示不自动改，如涉及数字） |
| `rejected` | 模型给了但被本地守卫拦下的改动：`{before, kind, reason}`（数字变更、片段不唯一、超长、区间重叠、会让正文超过 20000 字） |
| `review.before/after` | 原文与「按 `points` 里 AI 改动落地后」的**规则复检**结果；`after` 由内核重新判定，不是模型自述 |
| `review.resolved/remaining` | 被改掉 / 仍存在的缺陷标签 |
| `ai.status` | `ok`（模型已调用）/ `skipped`（未调用，原因见 `ai.note.code`） |
| `ai.note` | `skipped` 时 `{code, message}`，`code` ∈ `E_AI_OFF` / `E_AI_NO_KEY` / `E_AI_NOTHING_TO_FIX` |
| `verdict` | **始终来自规则内核**，与 GUI/CLI 同源，不受 AI 影响 |

### 调用方怎么用

1. 拿 `verdict.text` 决定「能不能交」（三档：`可以交付` / `建议改一遍再交` / `不建议直接交付`）。
2. 拿 `points[source=rule]` 出「必须处理的问题清单」（按 `severity` 排序）。
3. 拿 `points[source=ai]` 做自动改写：把 `before` 唯一匹配替换成 `suggestion`（区间用 `start/end` 更稳）。
4. 落地后用 `review.after` 当复核结论；`unresolved` 与 `rejected` 交给人工。

---

## 5. 错误码

| HTTP | code | 触发条件 | 客户端该怎么办 |
| --- | --- | --- | --- |
| 400 | `E_API_BAD_JSON` | 请求体不是合法 JSON | 修请求体 |
| 400 | `E_API_NO_TEXT` | `text` 缺失或全空白 | 补正文 |
| 400 | `E_TEMPLATE` | `templateId` 不在 5 套模板内 | 用响应里列出的 id |
| 400 | `E_API_BAD_REQUEST` | 请求头过大 / 空请求 | 检查请求格式 |
| 400 | `E_API_IO` | 读 socket 失败 | 重试 |
| 401 | `E_API_UNAUTHORIZED` | 缺 / 错 `Authorization: Bearer <token>` | 补 token |
| 404 | `E_API_NOT_FOUND` | 路径不存在 | 用 `/v1/health` 或 `/v1/points` |
| 405 | `E_API_METHOD` | 路径对、方法错 | 改方法 |
| 413 | `E_API_TOO_LARGE` | 请求体 > 512 KB | 只发正文，别塞无关字段 |
| 413 | `E_TOO_LARGE` | 正文 > 20000 个 UTF-16 码元 | 拆段或精简 |
| 429 | `E_API_RATE_LIMITED` | 超过 `YYB_API_RATE`（默认 30/min） | 退避重试 |
| 502 | `E_AI_BAD_JSON` | 模型返回不是约定 JSON | 换模型 / 重试 |
| 502 | `E_AI_HTTP_<code>` | 模型服务 4xx/5xx（已重试仍失败） | 看 `message` 里的原文 |
| 502 | `E_AI_CONNECT` / `E_AI_NET` / `E_AI_INTERNAL` | 连接失败 / 网络错误 / 内部错误 | 检查 base_url 与网络 |
| 504 | `E_AI_TIMEOUT` | 超过 `YYB_AI_TIMEOUT_MS` | 调大超时或重试 |
| 400 | `E_AI_CONFIG` | 运行时配置不合法 | 检查启动参数 |

`ai.status="skipped"` 是 **200 而不是错误**：说明模型这一步没参与，规则结论照常可用。

---

## 6. 调用示例

### curl

```bash
curl -s http://127.0.0.1:8788/v1/points \
  -H "Authorization: Bearer tok-abc" \
  -H "Content-Type: application/json" \
  -d '{"text":"本周完成了数据采集脚本的重构，采集速度提升 40%。","templateId":"weekly"}'
```

### PowerShell

```powershell
$body = @{ text = "本周完成了数据采集脚本的重构。"; templateId = "weekly" } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:8788/v1/points -Method Post \
  -Headers @{ Authorization = "Bearer tok-abc" } -ContentType "application/json; charset=utf-8" -Body $body
```

### Node.js

```js
const r = await fetch("http://127.0.0.1:8788/v1/points", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer tok-abc" },
  body: JSON.stringify({ text, templateId: "weekly" }),
});
const data = await r.json();
const edits = data.points.filter((p) => p.source === "ai");
```

### Python

```python
import requests
r = requests.post("http://127.0.0.1:8788/v1/points",
                  headers={"Authorization": "Bearer tok-abc"},
                  json={"text": text, "templateId": "weekly"}, timeout=60)
data = r.json()
```

---

## 7. 与既有能力的关系

| 能力 | 入口 | 是否共用同一实现 |
| --- | --- | --- |
| 规则判定 | 内核 `core/`（`core_ffi::check`） | 是，同一份 C++ 代码 |
| 模型改写 | `ai::revise_points_blocking` → `revise_blocking` | 是，与壳页「AI 修改」同一条链路（同提示词、同守卫、同重试、同超时） |
| 模型配置 | 进程内 `CFG`/`KEY`（由环境变量注入） | 是，与 `ai_get_config`/`ai_set_config` 共用结构体 |
| GUI / CLI | `yanyibian.exe` / `yyb-check.exe` | 同一 Cargo 包，三个 bin |

**为什么单独一个 exe**：GUI 需要 WebView2 与窗口会话，服务器场景（无桌面 / 计划任务 / 容器）起不来；`yyb-api` 只依赖 C++ 内核与网络，可在无窗口环境运行。

---

## 8. 安全与隐私

- **Key 不落盘**：只从环境变量读进 `Mutex<Option<String>>`，`/v1/health` 只回 `hasKey`，不回明文。
- **默认只监听回环**：`127.0.0.1:8788`；回环范围内（`127.0.0.0/8`、`::1`、`localhost`）换端口可直接跑；对外监听（如 `0.0.0.0:8788`）要显式 `YYB_API_ALLOW_REMOTE=1`，且必须设 token，否则**启动即拒绝**（exit 2）。
- **无请求日志**：服务端只打印监听地址与限流参数；不记录正文、不落缓存、不写历史。
- **外发内容最小**：只发送正文 + 模板 id + 已命中缺陷标签（`build_prompt`），不发送文件路径、不发送无关元数据（mock 记录 `leaksPath=false`）。
- **不联网即可用**：不开 AI 时零外联，响应仍是完整的规则结论。
- **限流是全局固定窗口**：多客户端共享 `YYB_API_RATE`。

---

## 9. 已知限制

| 限制 | 现状 | 影响 |
| --- | --- | --- |
| 无 TLS | 明文 HTTP | 跨机调用需自行加反向代理（nginx / Caddy） |
| 无 keep-alive | 每个响应 `connection: close` | 高频调用时连接开销大 |
| 每连接一线程 | 无连接池上限 | 极端并发可能耗尽线程 |
| 不支持 chunked | 必须有 `Content-Length` | 少部分客户端默认 chunked 会失败 |
| 无审计/指标 | 只有启动日志 | 生产环境需外部采集 |
| 限流不分 token | 单桶 | 多租户需前置网关 |
| 不返回 `HTML` 报告 | 只有 JSON | 报告由调用方渲染 |

---

## 10. 已裁定的默认方案（v1.10）

v1.9 列的 6 项「待裁定」已按**默认 / 最小改动**方案定下，代码与文档同步。今后若要改，改这一节并升文档版本；不再逐项等待确认。

| ID | 事项 | 采用的默认值 | 依据 | 落在哪里 |
| --- | --- | --- | --- | --- |
| Q-40 | 鉴权是否升级（多 token / HMAC 签名） | **不升级**：单静态 token，`Authorization: Bearer <token>`（也接受裸 token） | 单机自用场景；多 token 需配套分发/轮换，收益不抵复杂度 | `src-tauri/src/api.rs` `authorized()` |
| Q-41 | 是否允许监听 0.0.0.0 | **默认只允许回环**（`127.0.0.0/8`、`::1`、`localhost`）；确需对外时显式 `YYB_API_ALLOW_REMOTE=1`，且**必须设 token**（`YYB_API_ALLOW_ANON` 只对回环生效） | 安全默认优先，同时保留显式逃逸开关；v1.9 只提示风险，v1.10 改为启动即拒 | `src-tauri/src/bin/yyb_api.rs` `is_loopback_addr()` + 启动检查 |
| Q-42 | 限流是否按 token/IP 分桶 | **全局单桶**：固定窗口 60 s，默认 30 次/分钟 | 单进程自用；多租户应由前置网关做 | `src-tauri/src/api.rs` `rate_ok()` |
| Q-43 | `includeRules` 默认值 | **`true`**（一次调用同时拿规则命中与 AI 建议） | 规则判定才是结论来源；只要 AI 建议可显式传 `false` | `src-tauri/src/api.rs` `handle_points()` |
| Q-44 | 字段命名是否统一 camelCase | **统一 camelCase**（`apiVersion` / `points[].start` / `review.after` …）；`error.code`、`error.message` 保持既有写法 | 现状已是 camelCase，改成别的只增加破坏面 | `src-tauri/src/api.rs` 全部响应构造 |
| Q-45 | 是否需要流式（SSE）返回 | **不实现**：单次同步返回；长文本靠 `YYB_AI_TIMEOUT_MS`（默认 20000 ms）控制 | 单次 2–20 s 量级，SSE 需改造客户端读端，收益有限 | —（未实现，维持 v1.9） |

**由此产生的行为变化（仅一条）**：v1.9 用 token 就能监听 `0.0.0.0`；v1.10 起必须再加 `YYB_API_ALLOW_REMOTE=1`，否则拒绝启动（exit 2，中文提示写明怎么开）。其余 5 项与 v1.9 行为一致，只是写清了默认值。

---

## 11. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.9 | 2026-11-01 | 新增 `yyb-api`（`GET /v1/health`、`POST /v1/points`），复用 `ai::revise_blocking` 与内核判定；规则版本仍 `yyb-4`，593 例门禁不变 |
| v1.10 | 2026-11-01 | 6 项「待裁定」按默认方案落地：新增 `YYB_API_ALLOW_REMOTE` 开关（默认只回环，对外须显式开启且必须有 token）；其余 5 项维持现状并写入 §10 默认表 |
