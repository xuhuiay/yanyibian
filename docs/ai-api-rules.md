# 验一遍 · 外部 AI 通道规则（v0.2 / 2026-11-01）

本文是 **AI 修改通道** 的规则说明，也是验收口径。每一条都给出可直接核对的代码位置（行号以 2026-11-01 的工作区为准）。
配套文档：`docs/build-and-run.md`（构建与运行）、`docs/parity.md`（两端一致性）、方案文档 §8.4.1 与 §10。

---

## 1. 范围

- 通道属于**可选增强**：关闭时不联网、不读 Key、不改变任何判定结果。
- 判定结论（可以交付 / 不建议直接交付）**只由 C++ 内核 + JS 真源决定**，AI 只产出"建议改动"，最终是否采用由用户点按钮决定。
- AI 不参与：规则计算、字数上限判定、模板必需要素、禁区词表。参见 `src-tauri/src/ai.rs:531-637`（先 `core_ffi::check` 再让 AI 改，改完再 `core_ffi::check`）。

## 2. 默认状态与开关

| 项 | 默认值 | 位置 |
| --- | --- | --- |
| 通道开关 `enabled` | `false`（关闭） | `src-tauri/src/ai.rs:26-43`、`:51-63` |
| 服务商 `provider` | `openai` | 同上 |
| 接口地址 `base_url` | `https://api.openai.com/v1` | `ai.rs:22`、`:51-63` |
| 模型 `model` | 空（启用时必须填） | `ai.rs:96-121` |
| 允许改数字 `allow_fact_edit` | `false` | `ai.rs:26-43` |
| 超时 `timeout_ms` | 20000 | `ai.rs:44-46` |
| 重试次数 `max_retry` | 1 | `ai.rs:47-50` |
| API Key | 用户自填；v1.8 起壳页只存进程内存（`Mutex<Option<String>>`），不落盘 | `ai.rs:70-73` |

**开启步骤（可执行，v1.8 壳页）**：在 `shell/index.html` 的「AI 修改（可选）」区块里勾「启用」→ 选服务商 / 填接口地址 / 填模型名 / 填 API Key → 点「保存设置」→ 点「生成修改稿」。
保存走 `ai_set_config`（`ai.rs:145-162`），前端在 `shell/app.js` 的 `saveAi()`。
> v1.8 说明：v1.5 的独立设置页与 `localStorage` 持久化随 `ui/` 一并移除；壳页恢复的是四个命令的**调用入口**，配置只存在进程内存，重启需重填。（是否恢复本机持久化与加密方案：待补充 Q-33。）

**关闭行为（可验收）**：

1. 取消勾选并保存后，`ai_revise` 立即返回 `E_AI_OFF`，**不发起任何 HTTP 请求**（`ai.rs:534-538`）。
2. 关闭不改变已有校验结果、不清空编辑器、不删除已导出的文件。
3. 关闭后 Key 仍留在内存但不使用；**重启应用后 Key 与配置都不保留**（v1.8：无本机持久化），需要重新填写。
4. 实测：关闭状态下调用 5 次，mock 服务端计数为 0（见 §14 验收 C4）。

## 3. 服务方与协议

- 协议：**OpenAI 兼容的 `POST {base_url}/chat/completions`**（`ai.rs:281-388`）。
- 请求体：`{model, temperature:0, messages:[system,user], response_format:{type:"json_object"}}`（`ai.rs:300-340` 区域）。
- 鉴权头：`authorization: Bearer <key>`（`ai.rs:300-340`）。
- 地址校验（`ai.rs:82-121`）：
  - 必须非空；
  - 必须 `https://`，**例外**：`localhost` / `127.0.0.1` / `::1` 允许 `http://`（供本地网关与自测）；
  - 启用时 `model` 必填；
  - `timeout_ms` ∈ [3000, 120000]（`ai.rs:17-18`）；
  - `max_retry` ≤ 2（`ai.rs:96-121`）。
- 已内置服务商预设：`openai` / `deepseek` / `custom`（`shell/index.html:79-83`），三者都只是 base_url 的快捷方式，**请求格式完全一致**。

## 4. 鉴权与密钥

| 规则 | 说明 | 位置 |
| --- | --- | --- |
| 用户自填 | 应用不内置任何 Key、不代理、不中转 | `ai.rs:146-162` |
| 存放位置（v1.8） | 只在后端 `Mutex<Option<String>>`；壳页输入框不写 `localStorage` / 文件 / 日志，保存后立即清空输入框 | `ai.rs:70-73`、`shell/app.js` 的 `saveAi` / `paintAi` |
| 不回传前端 | `ai_get_config` 只返回 `hasKey:boolean`，永不返回 Key 本身 | `ai.rs:122-144` |
| 三种写入语义 | `null`=不改、`""`=清除、其它=替换 | `ai.rs:146-162` |
| 启用前必须有 Key | 否则 `E_AI_NO_KEY: 启用前请先填写 API Key` | `ai.rs:146-162` |
| 调用时缺 Key | `E_AI_NO_KEY: 未填写 API Key` | `ai.rs:540-544` |
| 界面掩码 | `<input type="password">`，保存后清空输入框并改占位文案 | `shell/index.html:86`、`shell/app.js:419-424` |
| 重启后 | v1.8：不保留（进程内存），重启后 `ai_get_config` 返回 `hasKey=false` | `ai.rs:122-136` |
| 可清除 | 壳页「清除 Key」按钮 → `ai_set_config{apiKey:""}`（内存即刻清空） | `shell/app.js` 的 `clearAiKey` |

风险提示（必须让用户看到）：v1.8 不落盘，因此**不存在**"Key 被同机其它进程从磁盘读走"的风险；代价是每次重启都要重填。若后续恢复持久化，必须用 DPAPI / Keystore 加密（**待补充：Q-33**）。仍**不要填长期/高额度 Key**，建议单独签发受限 Key。

## 5. 权限范围（发什么 / 不发什么）

**只发送三样**（`ai.rs:230-273`）：

1. 模板 ID（如 `weekly`）；
2. 内核给出的缺陷清单：等级、标签、类型、解释、以及缺陷命中的原文片段（`start/end` 有值时）；
3. 正文全文（用户正在校验的那段文字）。

**不发送**：文件名、文件路径、批量列表、历史记录、模板词表本身、Key 之外的任何本机信息（`ai.rs:230-273`；前端只把 `text + templateId` 传下去，`shell/app.js:439-462`）。

**实测证据**：mock 服务端记录 `leaksPath=false`（用 `/[A-Za-z]:\\|\\/tmp\\/|\\.docx\\b/` 扫请求体），且请求体不含文件名（§14 验收 C5）。

**第三方可见性**：正文会离开本机，到达用户自己填的服务商。应用本身不保存副本、不写日志（§8），但服务商侧如何处理由用户与其合同决定 —— 界面上以 `ai-privacy` 文案明示（`shell/index.html:89`）。

## 6. 调用上限、超时与重试

| 项 | 规则 | 位置 |
| --- | --- | --- |
| 单次改动条数 | ≤ 20 条 | `ai.rs:19` |
| `before` 长度 | 提示词要求 ≤200 字；本地硬上限 400 字 | `ai.rs:239`、`:403-510` |
| `after` 长度 | 提示词要求 ≤400 字；本地硬上限 1200 字 | 同上 |
| 超时 | 3000–120000 ms，默认 20000；连接超时取 `min(5000, timeout)` | `ai.rs:281-290` |
| 重试 | 仅对网络错误 / 429 / 5xx；退避 `400*(attempt+1)` ms；4xx 立即失败 | `ai.rs:300-380` |
| 最大尝试 | `1 + max_retry`（默认 2 次） | 同上 |
| 并发 | 同一时刻只允许一个在途请求；界面按钮在请求期间禁用 | `shell/app.js:433-462` |
| 取消 | `ai_cancel` 置原子标志；在途请求返回后丢弃结果并报 `E_AI_CANCELLED` | `ai.rs:163-175`、`:300-320` |
| 长度保护 | AI 改后若超 20000 码元，按倒序丢弃改动直到放得下，丢弃原因写进 `rejected` | `ai.rs:571-591` |

**取消的语义**：取消不会中断 TCP（reqwest 阻塞式无中止句柄），只是"返回后丢弃"，界面明确写「在途请求返回后丢弃结果」（`shell/app.js:464-472`）。实测：1.5 s 慢响应 + 300 ms 时取消 → `E_AI_CANCELLED`（1.5 s 处丢弃）。

## 7. 错误码与用户可见文案

| 错误码 | 触发条件 | 文案（原样） | 位置 |
| --- | --- | --- | --- |
| `E_AI_OFF` | 通道关闭时调用 | `AI 通道已关闭（在「AI 修改」面板里打开开关并保存设置后可用）` | `ai.rs:534-538` |
| `E_AI_NO_KEY` | 启用但无 Key | `启用前请先填写 API Key` / `未填写 API Key` | `ai.rs:146-162`、`:540-544` |
| `E_AI_CONFIG` | 地址/模型/超时/重试不合法 | `校验失败：<原因>` | `ai.rs:96-121` |
| `E_AI_TIMEOUT` | 超过 timeout_ms | `超过 N ms 未返回` | `ai.rs:340-360` |
| `E_AI_CONNECT` | 连接失败/DNS/TLS | `连不上服务：<原因>` | 同上 |
| `E_AI_NET` | 传输中断 | `网络中断：<原因>` | 同上 |
| `E_AI_HTTP_{code}` | 非 2xx | `服务返回 <code>：<响应体片段>` | `ai.rs:360-380` |
| `E_AI_BAD_JSON` | 返回不是约定 JSON | `返回内容不是约定的 JSON（<解析错误>）：<片段>` | `ai.rs:220-228` |
| `E_AI_CANCELLED` | 用户取消 | `已取消（结果已丢弃）` | `ai.rs:300-320` |
| `E_AI_NOTHING_TO_FIX` | 无缺陷 | `当前没有需要修改的缺陷，不需要调用 AI` | `ai.rs:552-556` |
| `E_AI_INTERNAL` | 线程池失败等 | `E_AI_INTERNAL: <原因>` | `ai.rs:640-645` |
| `E_TOO_LARGE` | 正文超 20000 码元 | `正文 N 个字符，超过单份上限 20000` | `limits.rs:7,21-23` |

所有错误都以字符串返回，前端直接显示在 `#ai-hint`（`shell/app.js:439-462`），不弹窗、不中断编辑。

## 8. 日志与隐私

| 规则 | 实现 | 位置 |
| --- | --- | --- |
| 不写日志文件 | 全仓没有日志文件写入；GUI 主程序无 `println!` 到文件，只有 debug 构建在启动时打印数据目录；命令行工具 `yyb-check` 打印到 stdout（不是产品行为） | `src-tauri/src/lib.rs:75-77`、`src-tauri/src/bin/yyb_check.rs:15-96` |
| 不写 localStorage / indexedDB | 壳页只把结果放内存 `ai.result`，配置与 Key 不进浏览器存储 | `shell/app.js` 的 `var ai = { ... }` |
| 不留历史 | 关窗即丢；批量结果也不落盘 | 同上 |
| 导出才算留存 | 壳页的「复制交付包」只写剪贴板（`navigator.clipboard`，失败回退 `execCommand`），不落盘；`save_report` 命令仍在但壳页未接 | `shell/app.js` 的 `copyText` / `buildDelivery`、`src-tauri/src/commands.rs:149-170` |
| 可核对 | 无痕扫描：在校验文本里埋标记后扫数据目录，命中数应为 0 | §14 验收 C6 |

**已实测**：本机 `%LOCALAPPDATA%\\cn.yanyibian.desktop`（WebView2 配置目录）169 个文件、158 个可读，扫 `MARKER-A6-9931` 命中 0。

## 9. 修改与交付流程

### 9.1 流程（`ai.rs:531-637`）

1. 通道关闭 → `E_AI_OFF`；配置不合法 → `E_AI_CONFIG`；无 Key → `E_AI_NO_KEY`。
2. 正文超 20000 码元 → `E_TOO_LARGE`（`ai.rs:546-549`）。
3. 先用内核校验，取缺陷清单；**无缺陷不调用 AI**（`ai.rs:550-556`）。
4. 组提示词 → 请求 → 解析 JSON。
5. **本地守卫**逐条裁决（见 9.2），能落地的才改。
6. 用内核**复检**改后文本，产出前/后对比（`ai.rs:593-609`）。
7. 返回 `revisedText / changes / rejected / unresolved / review / provider / model / elapsedMs / attempts / usage / maxUnits`。

### 9.2 可改 / 不可改（本地守卫，`ai.rs:403-510`）

| 判定 | 结果 | 理由文案 |
| --- | --- | --- |
| 改动条数为 0 | 全部进 `unresolved`（"全部缺陷"） | AI 没有给出可安全落地的最小改动… |
| `before` 为空 / 超 400 字 / `after` 超 1200 字 | 拒绝 | 片段为空或过长 |
| 含数字/百分比且 `allow_fact_edit=false` | 拒绝（整条） | 改动涉及数字/百分比/日期，按规则拦下（如需允许请打开 allowFactEdit） |
| `before` 在原文不唯一或找不到 | 拒绝 | 该片段在原文中出现多次，无法唯一替换 |
| 两条改动区间重叠 | 后者拒绝 | 与前一处在原文里重叠 |
| 改后超 20000 码元 | 倒序丢弃 | 会让正文超过 20000 字上限，已丢弃 |

**不自动改的典型内容**：数字、百分比、日期、金额、人名、机构名、引用原文、"需要新增事实才能补"的缺要素（如缺「风险」要用户自己写段落）。这些统一进 `unresolved`，界面显示在「需人工处理」（`shell/app.js:474-527`）。

### 9.3 交付物（三部分，逐处可核）

界面按钮：**应用到编辑器**（`shell/app.js:529-537`）、**导出交付包**（`shell/app.js:539-614`）。

导出的 .md 结构固定：

1. **一、修改稿** —— 改后全文（fenced block，可直接复制）；
2. **二、变更说明** —— 表格：序号 / 类型 / 原文 / 改后 / 理由；被拦下的改动单列「已拦下」；
3. **三、复检结果** —— 修改前/后结论、高/中/低、字数、已解决项、仍有项；
4. **四、未自动修改** —— `unresolved` 逐条（标签 + 原因）；
5. **五、边界与隐私** —— 说明 AI 只做文本改动、事实需人工确认、正文已发送给用户自选服务商。

每处改动都能在「变更说明」里对上原文（`before` 逐字来自原文，`start/end` 为 UTF-16 码元偏移），复检结果来自同一内核的二次计算，可独立复核。

## 10. 容量上限（20000）

| 层 | 值 | 作用 | 位置 |
| --- | --- | --- | --- |
| 模板建议长度 `maxChars` | weekly 300 / notice 200 / readme 500 / general 600 | **判定规则**（超出只提示，不拦截） | `core/src/yyb_templates.cpp`、JS 真源 `yanyibian.js` |
| 单份硬上限 `MAX_UNITS` | **20000** UTF-16 码元 | 超过直接拒绝，不进入判定 | `src-tauri/src/limits.rs:7` |
| 单文件字节 `MAX_FILE_BYTES` | 8 MiB | 读文件前拒绝 | `limits.rs:5` |
| 批量份数 / 总量 | 200 份 / 200 MiB | 超出的部分不处理并给一行错误 | `limits.rs:9-11`、`commands.rs:51-95` |

入口一致性：粘贴（`commands.rs:34-42`）、单文件（`text_io.rs:91-140`）、docx（`docx.rs`）、AI 改后（`ai.rs:571-591`）都走 `limits::too_long()`，文案与阈值同一真源（`limits.rs:21-23`）。

边界实测（§14 C1–C3）：20000 码元 → 正常出结论；20001 码元 → `E_TOO_LARGE`；10001 个 emoji（20002 码元）→ 同码；空文本 → `chars=0`、缺陷「全文为空」（D-08 口径，未改内核）。

**注意**：原实现上限是 200000，本次按验收口径收紧到 20000（更严格）；模板建议长度 300/200/500/600 未动，改动会破坏 493 例 parity 基线。

## 11. 配置项与命令 API

| 命令 | 参数 | 返回 | 位置 |
| --- | --- | --- | --- |
| `ai_get_config` | — | `{enabled,provider,baseUrl,model,allowFactEdit,timeoutMs,maxRetry,hasKey,maxUnits}` | `ai.rs:138-144` |
| `ai_set_config` | `config`, `apiKey?: string\|null` | 同 `ai_get_config` | `ai.rs:145-162` |
| `ai_cancel` | — | `bool` | `ai.rs:163-175` |
| `ai_revise` | `text`, `templateId` | 见 9.1 第 7 步 | `ai.rs:640-645` |

注册处：`src-tauri/src/lib.rs:14-47`。前端调用：`shell/app.js:390-472`。

## 12. 已知限制（如实记录）

1. 取消是"返回后丢弃"，不节省流量与服务商计费。
2. Key 自 v1.8 起只在进程内存（不落盘），重启即失效；系统凭据库（DPAPI/Keystore）仍未集成 —— 方案 §8.4.1 提到过，Q-33 待办。
3. 提示词里的长度建议（200/400 字）比本地硬上限（400/1200 字）更严，属"提示词保守 + 守卫兜底"的有意设计。
4. 只支持 OpenAI 兼容协议；不支持 Anthropic/Gemini 原生协议。
5. 不做流式输出：一次性返回、一次性渲染。
6. 无配额统计（token 用量只在返回体里透传 `usage`，不累计、不显示）。
7. 未接系统代理设置（reqwest 默认行为，`native-tls` + 系统代理未显式配置）。

## 13. 关闭与卸载后的残留

- 关闭开关：Key 仍在内存直到进程退出（可点「保存设置」并清空 Key 立即清除）。
- 卸载：安装包卸载会删程序与快捷方式，**保留** `%LOCALAPPDATA%\\cn.yanyibian.desktop`（WebView2 缓存，v1.2 已记录为 R-18，待 Q-19 裁定）。
- 该缓存目录中不含正文/Key（§8 已实测）。

## 14. 验收清单（可执行）

前置：`node tools/ai-mock/server.mjs 8799`（假 OpenAI 兼容服务，Key `test-key`），GUI 以 `--remote-debugging-port=9340` 启动。

| 编号 | 判据 | 命令 / 操作 | 期望 |
| --- | --- | --- | --- |
| C0 | 默认关闭、无 Key | `node tools/ai-mock/drive.mjs 9340 8799` 的 `config_default` | `enabled=false, hasKey=false, maxUnits=20000` |
| C1 | 20000 码元可校验 | 同上 `cap_20000_exact` | `chars=20000`，出结论 |
| C2 | 20001 码元被拒 | 同上 `cap_20001_over` | `E_TOO_LARGE: 正文 20001 个字符，超过单份上限 20000` |
| C3 | 空文本走内核 | 同上 `cap_empty` | `chars=0`，缺陷「全文为空」 |
| C4 | 关闭零外联 | 同上 `offRequests` / `offAgainRequests` | 均为 0 |
| C5 | 不泄露路径 | 同上 `okStats.leaksPath` | `false`；`authOk=true`；`temperature=0`；`responseFormat=true` |
| C6 | 无痕 | 埋 `MARKER-A6-9931` 校验后扫 `%LOCALAPPDATA%\\cn.yanyibian.desktop` | 命中 0 |
| C7 | 数字守卫 | 同上 `fact_guard` | `changes=0`，`rejected[0].reason` 含「按规则拦下」 |
| C8 | 唯一性守卫 | 同上 `dup_guard` | `rejected[0].reason` = 该片段在原文中出现多次，无法唯一替换 |
| C9 | 4xx 不重试 | 同上 `http400Calls` | 1 |
| C10 | 5xx/429 重试 | 同上 `http_500_retry.attempts` / `http_429_retry.attempts` | 2 / 2 |
| C11 | 超时 | 同上 `timeout` | `E_AI_TIMEOUT`，约 6.4 s（2 次尝试） |
| C12 | 取消 | 慢响应 + 300 ms 调 `ai_cancel` | `E_AI_CANCELLED: 已取消（结果已丢弃）` |
| C13 | 无缺陷不调用 | 同上 `nothing_to_fix` | `E_AI_NOTHING_TO_FIX`，mock 计数 0 |
| C14 | 未填 Key 拒绝启用 | 同上 `no_key_rejected` | `E_AI_NO_KEY: 启用前请先填写 API Key` |
| C15 | UI 全流程 | `node tools/ai-mock/drive-ui.mjs 9340 8799 D:/tmp-m5/ai-gui.png` | 复检对比 + 逐处修改 + 需人工处理三块渲染，点「应用到编辑器」后正文变修改稿并复检 |
| C16 | 单元测试 | `scripts\\test-windows.bat ai::` | 3 passed |

## 15. 变更记录

- 2026-11-01 v0.2：新增 AI 通道（OpenAI 兼容）、本地守卫、复检与交付包导出；单份上限 200000 → 20000；错误码与文案统一到 `limits::too_long`。
- 待办：系统凭据库、流式输出、token 用量统计、代理配置（见 §12）。


---

## 附：v1.7 迁移说明（2026-11-01）

- 本仓库只保留后端（判定内核 + Tauri 壳 + 命令层）。原 `ui/` 前端已移除，改为最小壳页 `shell/`；**AI 面板的全部界面控件随之移除**，`ai_get_config` / `ai_set_config` / `ai_cancel` / `ai_revise` 四个命令仍完整可用。
- 文中 `ui/app.js`、`ui/index.html` 的行号引用沿用 v1.6，已改为 `shell/*` 写法，v1.7 壳页不含 AI 界面。
- API Key 的持久化（`localStorage["yyb.ai.cfg.v1"]`）是**前端**行为，随 `ui/` 一并移除；后端始终只在内存持有 Key（`KEY: Mutex<Option<String>>`）。若后续需要持久化，需要重新设计并评估明文风险。
