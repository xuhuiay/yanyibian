# 验一遍 YanYiBian · 构建与运行说明（v1.4 / 2026-11-01）

> 对应方案文档：`（方案文档，未随本仓库分发；待补充：公开地址）`（v1.4，见其 §7 / §8 / §9 / §10）。
> 本文只讲「怎么构建、怎么跑、跑到什么程度」；判定口径见 `docs/parity.md`，外部 AI 通道的规则与验收见 `docs/ai-api-rules.md`。

## 1. 这是什么

`yanyibian-app` 是「验一遍」的独立桌面客户端：**C++17 规则内核（静态库，同进程）+ Tauri 2 壳 + 零框架静态前端**。
判定只有一份实现，且与 Web 端 `tools/parity/spec/yanyibian.js` **逐键等价**（由 593 例差分门禁强制）。

版本说明：程序版本仍是 **0.1.0**（安装包名不变）；v1.4 在同一版本号下加了「单份上限收紧到 20000 码元」与「可选外部 AI 通道（代号 v0.2）」。

0.1.0 的定位：**规则通道最小可运行版**——能粘贴/打开文本（`.txt` / `.md` / `.docx`）、选模板、出三档结论、标出缺陷原文、导出一份 Markdown 报告，能批量跑一批文件。

> 2026-11-01 v1.3 追加：`.docx` 导入已实现（方案 §9.2），读入层加了文本判定与输入上限（方案 §9.3）。

## 2. 环境要求

| 项 | 实测版本 | 说明 |
|---|---|---|
| OS | Windows 11 x64（目标：Windows 10 1809+ / 11 x64） | WebView2 依赖系统版本 |
| Rust | rustc / cargo 1.98.1 | `edition = "2021"` |
| MSVC | Visual Studio 18 Community，MSVC 14.51.36231 | 需要「使用 C++ 的桌面开发」工作负载 |
| Windows SDK | 10.0.26100.0 | 由 VS 安装器带入 |
| WebView2 Runtime | 156.0.4314.50（系统已装） | 未做固定版本打包（见 §7.2） |
| Node.js | v24.17.0 | **只用于门禁脚本**（`tools/parity/*.mjs`），不参与客户端构建 |

> 构建**不需要** `tauri-cli`、不需要 npm 依赖、不需要联网拉包（crate 已在 `~/.cargo/registry` 缓存；首次构建需要能访问 crates.io）。

## 3. 目录结构

```
yanyibian-app/
├─ core/                       C++17 规则内核（纯计算：无 IO / 无网络 / 无 UI）
│  ├─ include/yyb/yyb.h        对外 C ABI（唯一头文件）
│  ├─ src/yyb_text.{h,cpp}     UTF-8 ⇄ UTF-16 码元、空白判定（与 JS \s 同集）
│  ├─ src/yyb_pattern.{h,cpp}  MiniRE：按码元匹配的 ECMAScript 子集正则
│  ├─ src/yyb_templates.cpp    5 套模板 + 15 条示例（逐字段照 yanyibian.js）
│  ├─ src/yyb_engine.cpp       六类检查 / 结论 / 排序 / 区间
│  ├─ src/yyb_capi.cpp         C ABI 实现 + 固定键序 JSON 序列化
│  ├─ cli/main.cpp             yyb-cli：控制台门禁入口（支持 --tab 十六进制通道）
│  ├─ sources.txt              ★ 源清单唯一真源（cargo 与 CMake 都读它）
│  ├─ build-cli.bat            单独编译 yyb-cli（cl.exe，用于门禁与排障）
│  └─ CMakeLists.txt           可选：CMake 构建路径（不参与打包）
├─ src-tauri/                  Tauri 2 壳（Rust）
│  ├─ build.rs                 cc 编译内核 → tauri-build 生成上下文
│  ├─ tauri.conf.json          identifier / frontendDist=../ui / CSP / NSIS
│  ├─ capabilities/default.json 权限：core:default + dialog:default
│  ├─ src/lib.rs               Builder + 8 个命令注册 + 建窗（含数据目录探测）
│  ├─ src/core_ffi.rs          C ABI 的 Rust 侧声明与释放
│  ├─ src/commands.rs          8 个 IPC 命令
│  ├─ src/text_io.rs           读文件 + 编码解码（UTF-16 BOM / UTF-8 / GB18030）
│  ├─ src/bin/yyb_check.rs     yyb-check：控制台版，走完整 FFI 链路（无 GUI 验收用）
│  └─ icons/                   自绘图标（tools/make-icon.mjs 生成）
├─ ui/                         前端（零框架、零打包器，被编译进 exe）
│  ├─ index.html               顶栏 / 单篇 / 批量
│  ├─ styles.css               纸面墨色主题（系统字体栈，零外联）
│  └─ app.js                   invoke 调用、渲染、标红、导出报告
├─ tools/
│  ├─ parity/gen-corpus.mjs    生成 593 例语料（固定种子 20261101）
│  ├─ parity/gen-golden.mjs    用 JS 真源算期望值 → build/golden.jsonl
│  ├─ parity/rulemeta.mjs      导出 RULE_VERSION → build/rulemeta.json
│  ├─ parity/run-parity.mjs    逐键 deepEqual，先校验版本戳
│  ├─ ai-mock/server.mjs       假 OpenAI 兼容服务（自测 AI 通道）
│  ├─ ai-mock/drive.mjs        19 步 CDP 验收（AI + 容量边界）
│  ├─ ai-mock/drive-ui.mjs     UI 级验收 + 截图
│  └─ make-icon.mjs            零依赖 PNG/ICO 生成
├─ scripts/
│  ├─ build-windows.bat        探测 vcvars64 → cargo build --release
│  ├─ verify-all.bat           四步一键验收（见 §6）
│  ├─ test-windows.bat         探测 vcvars64 → cargo test --release --lib
│  └─ dbg-run.bat              调试用：cargo build（debug）+ 前台运行
└─ docs/
   ├─ parity.md               判定口径清单（12 条 + 编码通道 + 语料 + 变更记录）
   ├─ ai-api-rules.md         外部 AI 通道规则与验收（v0.2）
   └─ build-and-run.md        本文
```

## 4. 构建

### 4.1 一条命令（推荐）

```bat
cd /d <仓库根>
scripts\build-windows.bat
```

脚本做的事：按顺序探测 4 处 `vcvars64.bat`（VS 18 Community → VS 2022 Community → VS 2022 BuildTools → (x86) BuildTools），注入 MSVC 环境，然后 `pushd src-tauri && cargo build --release`。

产物：

| 文件 | 说明 |
|---|---|
| `src-tauri\target\release\yanyibian.exe` | GUI 客户端（前端资源已内嵌，单文件即可运行） |
| `src-tauri\target\release\yyb-check.exe` | 控制台版，用于无 GUI 验收整条 FFI 链路 |

### 4.2 为什么 `cargo build` 就够了

`tauri.conf.json` 里 `build.frontendDist = "../shell"` 且**没有** `devUrl`，所以 Tauri 在**编译期**把 `shell/` 内嵌进二进制。没有 dev server，也就不需要 `tauri-cli` / npm / Vite。

`build.rs` 做两件事：
1. 读 `core/sources.txt`（唯一源清单），用 `cc` 把每个 `.cpp` 编成静态库 `yyb_core`（`c++17`、`/utf-8`）；
2. 调 `tauri_build::build()` 生成上下文。

### 4.3 单独编译内核（排障 / 门禁）

```bat
core\build-cli.bat        :: 读 sources.txt，cl.exe 编出 core\build\yyb-cli.exe
```

也提供了 `core/CMakeLists.txt`（同样读 `sources.txt`），供习惯 CMake 的人单独验证 C++ 侧，**不参与打包**。

## 5. 运行

### 5.1 GUI

双击 `src-tauri\target\release\yanyibian.exe`。

| 操作 | 行为 |
|---|---|
| 选模板 chip | 立即按新模板重算（已有文本时） |
| 输入文本 | 200 ms 防抖后自动校验；`Ctrl+Enter` 立即校验 |
| 点缺陷条目 | 在文本框里选中该缺陷对应的原文区间（`start=-1` 的缺陷不可点） |
| 填入示例 | 换一条该模板下的示例文本 |
| 打开文件… | 选 `.txt/.md/.docx`；文本自动解码（UTF-16 BOM / UTF-8 / GB18030），docx 走 `src-tauri/src/docx.rs` 抽正文 |
| 导出报告 | 另存一份 Markdown（结论 + 缺陷与原文 + 通过项 + 原文块），路径由你选定 |
| 批量 tab | 多选文件 → 校验 → 表格（文件名/结论/字数/缺陷数）+ 批量报告导出 |

### 5.2 控制台（无 GUI 验收）

```bat
src-tauri\target\release\yyb-check.exe --version
src-tauri\target\release\yyb-check.exe --templates
src-tauri\target\release\yyb-check.exe --samples
src-tauri\target\release\yyb-check.exe weekly tools\parity\fixtures\smoke-weekly.txt
src-tauri\target\release\yyb-check.exe --dump D:\tmp-docx\samples\plain.docx
```

`weekly <文件…>` 对每个文件输出一行 JSON：`{"file","encoding","result"}`。
这条命令覆盖了 **Rust → C ABI → C++ 内核** 的完整链路，是「GUI 起不来时」最快的自检手段。
`--dump <文件…>` 只打印读入层抽出的正文（`{"file","encoding","bytes","text"}`），用于核对 docx/编码抽取是否丢字。
读入失败时两个命令都输出 `{"file":…,"error":"E_…"}` 并以退出码 1 结束。

### 5.3 已知环境约束：工作区内运行时数据目录会回退

如果 exe 放在 **受限沙箱目录**（例如本工作区 `D:\双百工程`）里运行，进程会以 **Low 完整性级别** 启动，对 `%LOCALAPPDATA%`（Medium IL）只读，WebView2 因此建不出 user data dir（现象：`拒绝访问 (os error 5)` 或 `0x8000FFFF`）。

代码里已做**候选链**：`%LOCALAPPDATA%` → `%LOCALAPPDATA%Low` → `%TEMP%`，取第一个「能建目录 + 能写探针文件」的。正常安装（用户目录 / Program Files）运行时命中第一候选，行为与常规应用一致；日志里会打印实际使用的目录（debug 构建）。

### 5.4 .docx 读入与错误码（v1.3）

docx 走 `src-tauri/src/docx.rs`：只读 `word/document.xml`，每个 `<w:p>` 产出一段、`<w:t>` 顺序拼接、段落间用单个换行；`<w:tab>` 变空格、`<w:instrText>/<w:delText>` 与 `<mc:Fallback>` 跳过；表格里的段落按文档顺序拍平（行列关系不保留）。**不做 trim**，`xml:space="preserve"` 的首尾空格保留。

| 错误码 | 含义 | 处理 |
|---|---|---|
| `E_DOCX_MALFORMED` | 不是 ZIP（假 docx）、EOCD 缺失、XML 损坏 | 换一份文件；或另存为 .txt 再试 |
| `E_DOCX_NO_TEXT` | 压缩包里没有 `word/document.xml` | 文件可能不是 Word 生成的 docx |
| `E_TOO_LARGE` | 正文 > 20,000 码元 / 解压后 XML > 64 MB / 文件 > 8 MB | 拆小或去掉图片后另存 |
| `E_NOT_TEXT` | 后缀像文本但内容含 NUL 或大量控制符（R-15） | 多半是选错了文件 |
| `E_UNSUPPORTED_FORMAT` | `.pdf`（未实施，Q-22）、`.doc`（旧二进制格式，Q-23） | 目前请先转成 .txt/.docx |

空 docx（只有空段落）**不报错**：抽出空串后由内核判单条 `high`「全文为空」，与空 `.txt` 的结论逐键相同。

### 5.5 外部 AI 通道（可选，v0.2）

默认**关闭**，关闭时不联网、不读 Key。v1.8 起由仓库自带的壳页提供入口：`shell/index.html` 页面下方「AI 修改（可选）」区块 → 勾「启用」→ 服务商（OpenAI / DeepSeek / 自定义）→ 接口地址 → 模型 → API Key → 「保存设置」→「生成修改稿」。

> v1.8 说明：v1.5 的独立设置页与 `localStorage` 持久化随 `ui/` 一并移除。壳页恢复的是四个 AI 命令（`ai_get_config` / `ai_set_config` / `ai_cancel` / `ai_revise`）的**调用入口**；配置与 Key 只存在进程内存，重启需重填。

- 协议：OpenAI 兼容 `POST {base_url}/chat/completions`；必须 `https`（`localhost` / `127.0.0.1` / `::1` 允许 `http`，供本地网关自测）。
- Key：只在后端进程内存（`Mutex<Option<String>>`），不回传前端、不写 `localStorage`、不落盘；「清除 Key」即刻清空，重启即失效。若要恢复本机持久化，必须用 DPAPI / Keystore 加密（**待补充：Q-33**）。
- 发送内容：正文 + 模板 ID + 缺陷清单（等级/标签/类型/解释/命中片段）；**不发**文件名、路径、历史。
- 流程：内核校验 → 取缺陷（无缺陷不调用）→ AI 给最小改动 → 本地守卫（数字/唯一性/长度/重叠）→ 内核复检 → 界面显示「复检对比 / 逐处修改 / 需人工处理」→ 可「应用到编辑器」（写回 textarea 并立即重校验）或「复制交付包」（修改稿 + 变更说明 + 复检结果，只写剪贴板）。
- 失败与重试：超时默认 20000 ms（3000–120000 可调）；仅 429/5xx/网络错误重试（默认 1 次）；4xx 不重试；「取消」= 结果返回后丢弃。
- 错误码、隐私、逐条验收见 `docs/ai-api-rules.md`。

自测：`node tools/ai-mock/server.mjs` 起一个假 OpenAI 兼容服务（`127.0.0.1:8799`，Key `test-key`；支持 `MOCK_MODE=ok|fact|dup|nothing|badjson|e400|e500|slow|cancel`，`GET /__stats` 看调用记录）。壳页里把服务商选「自定义」、接口地址填 `http://127.0.0.1:8799/v1`、模型填 `mock-model`、Key 填 `test-key`，保存后点「生成修改稿」即可离线验证整条链路。

### 5.6 字数上限：一个阈值，五处生效（v1.6）

单份正文硬上限 **20,000** 字，真源只有一处：`src-tauri/src/limits.rs` 的 `MAX_UNITS`（第 7 行）。其它位置都引用它，不再各写一个数字。

| 生效点 | 位置 | 行为 |
|---|---|---|
| 粘贴/单篇校验 | `src-tauri/src/commands.rs` `check_text`（第 37 行） | 超限返回 `E_TOO_LARGE`，**不入内核** |
| 单文件读入 | `src-tauri/src/text_io.rs`（第 120、139 行） | 读入后超限即拒，docx 与纯文本同一文案 |
| docx 抽取中 | `src-tauri/src/docx.rs`（第 65 行） | 抽字过程累计超限即停（防解压炸弹） |
| 批量逐份 | `commands.rs` `check_files` → `text_io` | 单份超限只让该行失败，其余照常 |
| AI 修改稿 | `src-tauri/src/ai.rs`（第 547 行入参、第 572 行出参） | 入参超限直接拒；出参超限则倒序丢弃改动 |

前端不再抄阈值：启动时调只读命令 `limits_info` 拿 `{ maxUnits, maxFileBytes, maxBatchFiles, maxBatchBytes }`，显示在编辑区统计行末段：

- 常规：`上限 20,000 字`（灰）
- ≥ 95%：`接近上限 19,000 / 20,000 字`（琥珀）
- 恰好等于：`已达上限 20,000 字`（琥珀）
- 超出：`超出上限 N 字（上限 20,000）`（红），同时右侧结论显示 `超出字数上限` + 后端原文

**两个口径不要混**：统计行的 `19800 / 300 字` 是「内核计数字符 / 模板建议长度」，内核计数**不含空白**；硬上限按**含空白的 UTF-16 码元**计（emoji 算 2）。所以 20,000 码元的文本可能显示为 19,800 字，这不是 bug——悬停统计行有 `title` 说明。

**超限处理是「拒绝」**：不截断、不静默丢弃，输入框也不设 `maxlength`（设了会变成粘贴即截断，属行为变更）。

**未改的一项（需产品裁定）**：模板自身的 `maxChars`（周报 300 / 通知 200 / 项目说明 500 / 通用 600）是**判定规则**，超了只出一条 `mid`「长度」缺陷，不拦提交。若希望长文档不再因长度被提示，需要新增模板或提高 `maxChars`——那会改动 `core/` 与 `tools/parity` 的 493 例语料并升 `RULE_VERSION`，本次未动（见方案 §12.4）。

### 5.7 壳页：随机示例与命令入口（v1.8）

`shell/` 是仓库自带的最小壳页，用于端到端验证「C++ 内核 → C ABI → Tauri 命令 → 界面」整条链路，不是完整产品界面。

**随机示例**：内置示例（`SAMPLES`，规格真源 `tools/parity/spec/yanyibian.js`）共 **15 条，每套模板 3 条**。点「随机示例」会从当前模板的示例里随机抽一条填入，并提示「已随机填入示例：<标题>（共 3 条，再点一次换一条）」；连续两次不会抽到同一条（`state.lastSample` 记上次索引）。示例同时通过 `list_samples` 暴露，C++ 侧 `yyb_list_samples_json` 返回同一份文案。

**命令入口**：壳页覆盖 13 个 Tauri 命令中的使用侧 7 个 —— `api_version` / `limits_info` / `list_templates` / `list_samples` / `check_text` / `load_text_file`（经「打开文件…」）/ `pick_text_files`；批量与导出（`check_files` / `save_report`）以及 AI 四个命令在 CLI 或集成方调用（AI 已在 §5.5 接回壳页）。

**判定口径未变**：壳页只调用命令，不实现任何判定；随机示例、AI 面板都不影响 `check_text` 的结果。门禁仍是 `tools/parity` 的逐键比对（v1.8：593 例，RULE_VERSION=yyb-4）。

## 6. 验收

### 6.1 一条命令跑全套

```bat
scripts\verify-all.bat
```

| 步骤 | 内容 | 通过标志 |
|---|---|---|
| 1/4 | `rulemeta.mjs` + `gen-corpus.mjs` | 生成 `build/corpus.jsonl` 与 `build/rulemeta.json` |
| 2/4 | `build-cli.bat` + `gen-golden.mjs` + `run-parity.mjs` | `[parity] PASS 593/593 一致（RULE_VERSION=yyb-4）` |
| 3/4 | `build-windows.bat` | 两个 exe 落地 |
| 4/4 | `yyb-check --version` + `yyb-check weekly tools\parity\fixtures\smoke-weekly.txt` | 版本 `yyb-4`；`chars 78` / `defects 3` / `passes 5` |

末行出现 `ALL CHECKS PASSED` 即全绿。

### 6.2 本次（2026-11-01）实测结果

| 项 | 结果 |
|---|---|
| 差分门禁 | `PASS 593/593`（`RULE_VERSION=yyb-4`） |
| 构建 | 首次 1m 06s；改源码后 1m 18s；无改动 0.36s。**v1.4**：`yanyibian.exe` **7,714,304 B**（加 reqwest/native-tls 共 +914 KB）、`yyb-check.exe` 691,200 B；v1.3 为 6,800,384 B |
| FFI 冒烟 | `yyb-check weekly tools\parity\fixtures\smoke-weekly.txt` → 3 条缺陷（缺「风险」/ 套话「赋能」/ 量化断言 2 处）、5 项通过 |
| GUI 实测 | 通过 WebView2 远程调试（CDP）驱动真实窗口，结论「不建议直接交付」、缺陷 3 条、通过项 5 条，与 CLI/JS 逐字一致 |
| Web 页 | `验一遍/check.html` 截图核对：徽章 `yyb-2`，结论/缺陷/通过项/原文高亮与桌面端一致 |

编译期有 1 条无害告警：`core\cli\main.cpp(19): warning C4996: 'fopen'`（门禁工具读文件用，未改为 `fopen_s`）。

### 6.3 打安装包（M5）

```bat
scripts\build-bundle.bat
```

| 项 | 值 |
|---|---|
| 脚本做的事 | 探测 4 处 `vcvars64.bat`（18 Community / 2022 Community / 2022 BuildTools / x86 BuildTools）→ `node %TAURI_CLI% build` |
| `TAURI_CLI` | 默认指向本机已有的 `@tauri-apps/cli` 的 `tauri.js`（2.11.4）；可用环境变量覆盖 |
| 为什么不用 `cargo install tauri-cli` | 本机未装、registry 也无该包；用 node 版 CLI 不必往工程里加 `package.json` / `node_modules`，保持「纯 cargo 构建」 |
| 产物 | `src-tauri\target\release\bundle\nsis\YanYiBian_0.1.0_x64-setup.exe` = **2,171,674 B**（v1.5 实测；v1.3 为 1,891,936 B） |
| 耗时 | 首次 **84.8 s**（含 `cargo build --bins --features tauri/custom-protocol --release` 的 1m18s）；增量重打包约 5–8 s；v1.3 加依赖后首次 1m09s（cargo 单测构建） |
| 载荷 | v1.5：`yanyibian.exe` 7,717,888 B ＋ `yyb-check.exe` 691,200 B ＋ `uninstall.exe` 79,175 B（v1.3 为 6,799,360 + 691,200 + 79,175） |
| 装包前置 | GUI 在跑会 `failed to remove … yanyibian.exe: 拒绝访问 (os error 5)`：先 `taskkill /F /IM yanyibian.exe` |
| 中间脚本 | `src-tauri\target\release\nsis\x64\installer.nsi`（Tauri 生成，可审、勿手改） |

> 构建期有 1 条无害告警：`STATIC_VCRUNTIME is deprecated; use build.windows.staticVCRuntime`。
> CLI 2.11.4 打包的是 `tauri 2.12.5` 的应用（版本错配，实测正常），CI 上应固定同一版本。

### 6.4 安装与卸载

```bat
REM 不要在工作区内直接运行安装包（工作区里的 exe 会被降到 Low IL，见 §5.3）
copy src-tauri\target\release\bundle\nsis\YanYiBian_0.1.0_x64-setup.exe %TEMP%\
%TEMP%\YanYiBian_0.1.0_x64-setup.exe /S
start "" "%LOCALAPPDATA%\YanYiBian\yanyibian.exe"
"%LOCALAPPDATA%\YanYiBian\uninstall.exe" /S
```

| 项 | 实测结果 |
|---|---|
| 安装位置 | `%LOCALAPPDATA%\YanYiBian`（`installMode: currentUser`，**不需要管理员**） |
| 注册表 | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\YanYiBian`（DisplayVersion `0.1.0`、Publisher `yanyibian` 等 9 项） |
| 快捷方式 | 开始菜单 `YanYiBian.lnk`；桌面 `YanYiBian.lnk`（**静默安装会建**，交互安装在完成页按钮里建） |
| 卸载 | `uninstall.exe /S` → 安装目录、注册表键、两个快捷方式**全部移除** |
| **残留** | `%LOCALAPPDATA%\cn.yanyibian.desktop`（WebView2 配置，实测 11 MB / 180 文件）**不会删** |
| WebView2 | `installer.nsi` 用的是 `downloadBootstrapper`：目标机没有 WebView2 时会去 `go.microsoft.com` 下载 → **离线机器装不上**（见方案 §8.4.8） |

### 6.5 装后验证（4 组，均可复放）

| # | 验证 | 做法 | 期望 |
|---|---|---|---|
| V1 | GUI 功能闭环 | 启动装好的 exe，灌入 `tools\parity\fixtures\smoke-weekly.txt`；再载入 `D:\tmp-docx\samples\hyperlink.docx` | txt：结论「不建议直接交付」、缺陷 3 条、通过项 5 条；docx：`49 / 300 字`、缺陷 4 条、encoding=`DOCX`，均与 `yyb-check` 逐字一致 |
| V2 | 断网可用 | `set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--host-resolver-rules=MAP * ~NOTFOUND` 后启动 | 结果与 V1 完全相同；页面资源全部 `tauri://localhost` |
| V3 | 批量与隔离 | 205 份（含 20 份 docx）跑 `check_files`；再混入不存在文件、假 docx、`rand.bin` | 205 份 24 ms，200 条结果 + 1 条 `E_TOO_LARGE`；坏文件分别报 `E_IO` / `E_DOCX_MALFORMED` / `E_NOT_TEXT`，均不影响其余 |
| V4 | 无痕 | 输入带唯一标记的正文并校验后，全量扫描 `%LOCALAPPDATA%\cn.yanyibian.desktop` 与安装目录 | 0 命中（安装目录只在内核常量里命中样例文本） |

### 6.6 净机验证的边界（必读）

本轮**没有做净机验证**：本机无 Windows Sandbox（`C:\Windows\System32\WindowsSandbox.exe` 不存在）、`Get-WindowsOptionalFeature` 非提权不可查、也没有第二台机器或虚拟机。
因此 §6.5 是**替代验证**，不能作为「干净机器可用」的证据。残余风险：无 WebView2 的 Win10 1809 实机、真实杀软/组策略环境、非 100%/150% 缩放。
## 7. 0.1.0 已实现 / 未实现

### 7.1 已实现

| 层 | 内容 |
|---|---|
| 内核 | 六类检查（长度/要素覆盖/禁用项/语气/格式/事实一致性）、三档结论、缺陷稳定排序 + 解释、定位区间去重叠、通过项、5 套模板、15 条示例；空文本（含纯空白）判单条 `high`「全文为空」（`type=格式`，`start=-1`）并跳过其余检查；前端不前置拦截，照常展示内核结论 |
| C ABI | `yyb_check_json_n` / `yyb_list_templates_json` / `yyb_list_samples_json` / `yyb_rule_version` / `yyb_free` |
| Rust 命令 | `api_version` / `list_templates` / `list_samples` / `check_text` / `load_text_file` / `check_files` / `pick_text_files` / `save_report` |
| 文件解码 | UTF-16LE/BE BOM → 严格 UTF-8 → GB18030，统一去 BOM；`.docx` 走 `docx.rs` 抽正文（§5.4）；`.pdf/.doc` 仍返回 `E_UNSUPPORTED_FORMAT` |
| 读入加固（v1.3） | 文本判定（NUL / U+FFFD >2% / C0 >5%）→ `E_NOT_TEXT`；上限 8 MB/份、**20,000 码元**（v1.4 由 200,000 收紧）、200 份/批、200 MB/批 → `E_TOO_LARGE` |
| 前端 | 单篇/批量双 tab、模板 chip、防抖校验、结论三色、缺陷清单 + 点击定位、原文 `<mark>` 标红、通过项、Markdown 报告导出、批量表格 + 批量报告 |
| AI 通道（v1.4，v1.5 改配置位置与 Key 存储） | 4 个命令 `ai_get_config` / `ai_set_config` / `ai_cancel` / `ai_revise`；默认关闭、配置在「设置」视图、Key 本机持久化（明文，待补充加密）、本地守卫（数字/唯一性/长度/重叠）、改后内核复检、交付包导出；规则见 `docs/ai-api-rules.md` |
| 硬化 | CSP `default-src 'self'`、系统字体栈、无 updater、无历史记录、正文不落盘；HTTP 客户端只在用户显式启用 AI 通道后才发请求（关闭时零外联，实测计数 0） |
| Web 端 | `验一遍/check.html`：站点首个能跑内核的校验页（同一份 `yanyibian.js`） |

### 7.2 未实现（顺延，按优先级）

| 项 | 现状 | 阻塞/依赖 |
|---|---|---|
| ~~NSIS 安装包~~ | ✅ 已出包并装了/跑了/卸了（§6.3–6.5）；**净机验证仍未做**（§6.6） | 需一台干净机器 |
| WebView2 固定/离线安装包 | 用系统已装运行时 | 方案 T15 双轨策略未落地 |
| 批量进度与取消 | 串行执行，无事件、无取消按钮（A8 的「可取消」判 FAIL） | 方案 §8.4.7：`check_files_start` + `batch:progress` + `AtomicBool` |
| ~~批量份数/单份大小上限~~ | ✅ v1.3 已设 8 MB / 200 份 / 200 MB；**v1.4 单份码元上限 200,000 → 20,000**；`rand.bin` 返回 `E_NOT_TEXT` | 扩展名白名单仍未做（Q-25）；200 MB 与 zip bomb 无实测样本 |
| 细粒度错误码 | 现有 `E_TEMPLATE` / `E_JSON` / `E_IO` / `E_UNSUPPORTED_FORMAT` / `E_NOT_TEXT` / `E_TOO_LARGE` / `E_DOCX_MALFORMED` / `E_DOCX_NO_TEXT` | 仍缺 `E_DECODE`（解码是 lossy 的，方案 §7.4 #9） |
| `.docx` 解析 | ✅ v1.3 已实现（`zip` + `quick-xml` 自解，6 份样本逐字一致，方案 §9.2） | — |
| `.pdf` 解析 | 返回 `E_UNSUPPORTED_FORMAT` | 方案 §8.4.3：先 `lopdf`，中文不达标再 `pdfium-render`；**⏳待补充：20 份真实中文 PDF 样本（Q-22）** |
| 语义通道 | ✅ v1.4 落地「用户自带 Key 的 OpenAI 兼容通道」（默认关闭）；不做服务端代理、不内置任何服务商 | 流式输出、token 统计、系统代理、系统凭据库（DPAPI/Keystore）仍未做 |
| Android | 无 | M8；**⏳待补充：交付形态**（Q-14） |
| 暗色主题（A9） | 只有亮色纸面主题 | Q-15 |
| 模板要素表展示（F-19 完整版） | chip 只显示名称 + 摘要 | M2 收尾 |
| CI、代码签名、许可证 | 均未做 | Q-08 / Q-10 / Q-07 的许可证子项 |
| 日志脱敏与数据目录扫描（A5/A6 正式验收） | 设计上合规，未做审计 | M4 收尾 |

## 8. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `link.exe not found` | 没有 MSVC 环境 | 用 `scripts\build-windows.bat`（它自己 call vcvars64）；或手动 `call vcvars64.bat` 后再 `cargo build` |
| `error[E0758]: unterminated block comment` | Rust 注释里出现了 `/*`（Rust 支持嵌套块注释） | 注释里别写 `/*`（尤其不要写 `core/src/*.cpp`） |
| 起窗即退出、日志 `拒绝访问 (os error 5)` | 见 §5.3（Low IL 沙箱） | 装到用户目录运行，或依赖候选链回退 |
| `HRESULT(0x8000FFFF)` | WebView2 拿不到 user data dir（或上一实例未退干净） | 同上；确认没有遗留 `msedgewebview2` 进程 |
| 打开非 UTF-8 老文档出现乱码 | 解码是 lossy 的（坏字节 → `U+FFFD`），不会报错 | 已知限制：无「解码失败」错误码，见方案 §7.4 #9 |
| 门禁报版本不一致 | `rulemeta.json` / `yyb-cli --version` / JS 真源 `RULE_VERSION` 三者不等 | 重新跑第 1 步生成 `rulemeta.json`，再重编 `yyb-cli` |
| 读入失败：`E_UNSUPPORTED_FORMAT: .docx` | v1.2 及更早的构建没有 docx 解析 | 用 v1.3 之后的构建（`yyb-check --dump x.docx` 能出正文即新版） |
| 读入失败：`E_DOCX_MALFORMED` | 文件不是 ZIP（常见于把 .doc/.rtf 改名成 .docx，或下载被截断） | 用 Word/WPS 重新另存为 .docx |
| 读入失败：`E_NOT_TEXT` | 后缀是 .txt/.bin 之类，但内容含 NUL 或大量控制符 | 确认选对了文件；二进制请勿送进校验 |
| 读入失败：`E_TOO_LARGE` | 文件 > 8 MB、正文 > **20,000** 码元，或批量超 200 份/200 MB | 拆小后再校验（上限是常量，见 `src-tauri/src/limits.rs`） |
| 中文全变乱码（CLI --tab） | hex 按大端拼码元了（历史 bug） | 已修：`byte0 = hex[0]<<4|hex[1]` 作低字节 |
| `cmd /c "x.bat"` 只回显 banner | Git Bash 下 `/c` 被路径转换 | 用 `cmd //c "…"`，且不要同时设 `MSYS_NO_PATHCONV=1` |
| 编译报 `aws-lc-sys`：`stdalign_check.c` / `lib.exe` 1104 / `NASM command not found` | reqwest 默认 `rustls` 会拉 `aws-lc-sys`，本机没装 NASM | 改用 `features = ["blocking","json","native-tls"]`（Windows 走 schannel），见 `src-tauri/Cargo.toml` |
| `ai_set_config` 抛空异常、配置保存不了 | Tauri 只把**命令参数**转 camelCase，**结构体字段**不转，`baseUrl` 对不上 `base_url` | `AiConfig` 上加 `#[serde(rename_all = "camelCase")]`（`src-tauri/src/ai.rs:27`） |
| AI 报 `E_AI_CONNECT` / `E_AI_HTTP_*` | 服务地址不可达、Key 错、模型名错 | 先用 `node tools/ai-mock/server.mjs 8799` 自测；`http://` 只允许 localhost |
| AI 返回「全部缺陷」需人工处理 | 模型的改动全被本地守卫拦下（改数字/片段不唯一/超长） | 属预期：数字与事实类改动一律交人工，见 `docs/ai-api-rules.md` §9.2 |
| 启动即 panic，`HRESULT(0x8007139F)`「组或资源的状态不是执行请求操作的正确状态」 | WebView2 数据目录已损坏（常见于低完整性环境下反复失败的残留） | 关闭应用，把 `%LOCALAPPDATA%\cn.yanyibian.desktop` 改名（如加 `.bak`）后重启；v1.5 尚未自动避险（R-26） |
| 想清掉已保存的 Key | v1.8 只存在后端进程内存 | 壳页 AI 区块点「清除 Key」；或直接重启应用 |

## 9. 待补充清单（本文相关）

| 项 | 说明 |
|---|---|
| ~~docx 解析库~~ | ✅ 已定并实施：`zip 9.2.0` + `quick-xml 0.42.0`（方案 §9.2）；PDF 仍缺 PDFium 体积与是否仅 Windows |
| 旧 `.doc` 是否支持 | Q-23：需 CFB 解析或外部转换，成本高于 docx |
| 加密 docx | 无样本；现返回 `E_DOCX_MALFORMED`，是否要专门文案待定 |
| docx 表格是否结构化 | Q-26：当前拍平成段落 |
| 批量取消 | Q-24：实测 205 份 24 ms，是否仍按 A8 字面判据补齐待裁定 |
| 扩展名白名单 | Q-25：现为黑名单 + 内容启发式 |
| 语义通道接口 | 模型、是否联网、密钥存储、与规则结果的合并口径 |
| Android 交付形态 | APK 是否复用同一套前端与内核（内核需交叉编译） |
| 单份/批量上限 | Q-05 已按 §8.4.4 落地（8 MB / **20,000 码元**（v1.4 收紧）/ 200 份 / 200 MB），取值可调（Q-20） |
| 许可证 | Q-07 的许可证子项 |
| WebView2 分发方式 | 现状 `downloadBootstrapper` 需联网；建议双包（在线 1.7 MB + 离线约 +150 MB，体积待核实） |
| Android 最低 API / ABI / 分发 | 方案 §8.4.2；本轮无 Android SDK，未核实 |
| ~~语义通道密钥与服务商~~ | ✅ v1.4 已定：用户自带 Key、OpenAI 兼容、允许自定义 `base_url`、默认关闭、不做服务端代理；v1.5 起 Key 本机持久化但**明文**，系统凭据库/DPAPI 加密仍缺（Q-33） |
| 代码签名证书 | 方案 §8.4.5：OV/EV/云签名，费用待询价 |

## 10. 更新与发布清单（可复用）

固定顺序：**改版本 → 跑门禁 → 打包 → 装后验证 → 推送仓库 → 归档记录**。任一步失败就停在该步，不要跳过继续。

### 10.1 第 1 步：改版本号（两处必须同时改）

| 文件 | 位置 | 现值 |
|---|---|---|
| `src-tauri/Cargo.toml` | 第 3 行 `version = "0.1.0"` | 0.1.0 |
| `src-tauri/tauri.conf.json` | 第 4 行 `"version": "0.1.0"` | 0.1.0 |

两处不一致会导致安装包名与「关于/控制面板」版本对不上（`YanYiBian_<version>_x64-setup.exe` 取 `tauri.conf.json`，exe 资源版本取 `Cargo.toml`）。

### 10.2 第 2 步：跑门禁（必须全绿才继续）

```bat
cd /d %USERPROFILE%\..\path\to\yanyibian-app   :: 换成你的目录
scripts\verify-all.bat
```

通过判据（逐字核对）：

| 判据 | 期望 |
|---|---|
| 差分门禁 | `[parity] PASS 593/593 一致（RULE_VERSION=yyb-4）` |
| 冒烟 | `yyb-check weekly tools\parity\fixtures\smoke-weekly.txt` → `chars 78`、`defects 3`、`passes 5` |
| 收尾 | `ALL CHECKS PASSED` |
| 单测（可选但建议） | `scripts\test-windows.bat ai::` → `3 passed` |

若改过内核或语料：先升 `RULE_VERSION`（`core/src/yyb_engine.cpp` 的 `RULE_VERSION` 与 `tools/parity/rulemeta.mjs` 同源），再 `gen-corpus` → `gen-golden` → `run-parity`。

### 10.3 第 3 步：打包

```bat
taskkill /F /IM yanyibian.exe
scripts\build-bundle.bat
```

| 产物 | 路径 | 实测（0.1.0） |
|---|---|---|
| NSIS 安装包 | `src-tauri\target\release\bundle\nsis\YanYiBian_<version>_x64-setup.exe` | **2,171,674 B**（v1.5） |
| GUI | `src-tauri\target\release\yanyibian.exe` | 7,717,888 B（v1.5，已打 bundle 标记） |
| CLI | `src-tauri\target\release\yyb-check.exe` | 691,200 B |

前置：GUI 必须已退出（否则 `failed to remove ... 拒绝访问 (os error 5)`）；`tauri-cli` 走 `%TAURI_CLI%` 或 `scripts\build-bundle.bat` 里写死的 node 入口，不要求全局安装。

### 10.4 第 4 步：装后验证（5 项）

| 项 | 做法 | 判据 |
|---|---|---|
| 安装 | `YanYiBian_*_x64-setup.exe /S` | 出现 3 个 exe（本机实测落在 `D:\YanYiBian\`，注册表 `InstallLocation` 同值；**（待核实）** NSIS 记住上次目录的行为）；`HKCU\...\Uninstall\YanYiBian` 有 9 项 |
| 启动 | 从开始菜单启动 | 窗口出现，顶栏显示规则版本 badge |
| 判定 | 批量页选 `tools\parity\fixtures\smoke-weekly.txt` | 结论「不建议直接交付」+ 3 条缺陷 + 5 项通过 |
| 配置 | 壳页保存配置 → 退出 → 重启 | v1.8：配置与 Key 都不保留，需重填（`ai_get_config` 返回 `hasKey=false`） |
| 卸载 | `uninstall.exe /S` | 目录、注册表、快捷方式消失（`%LOCALAPPDATA%\cn.yanyibian.desktop` 保留） |

### 10.5 第 5 步：推送仓库（**当前卡点**）

| 项 | 现状 |
|---|---|
| 应用代码仓库 | **（待补充：`yanyibian-app` 尚未 `git init`，没有远端）** |
| 站点仓库 | `<站点仓库（已移出本仓库，本地备份见 _backup/）>` → `https://github.com/xuhuiay/yanyibian.git`，分支 `main` |
| 凭据 | 本机 credential.helper 指向 `PortableGit/mingw64/bin/git-credential-manager.exe`；本轮实测 `git ls-remote origin` 返回 `Recv failure: Connection was reset`，`curl https://github.com` 超时 → **推送未验证** |

站点仓库的推送命令（网络恢复后可直接用）：

```bat
cd /d <站点仓库（已移出本仓库，本地备份见 _backup/）>
git status
git add -A
git commit -m "check: 新增交付前校验页 check.html"
git push origin main
```

应用仓库首次推送（先补远端地址，再执行）：

```bat
cd /d <仓库根>
git init
git add -A
git commit -m "chore: v0.1.0 桌面客户端（C++ 内核 + Tauri 外壳）"
git remote add origin （待补充：应用仓库地址）
git push -u origin （待补充：分支名）
```

注意：`yanyibian.js` 必须随仓库入库（差分门禁的规格真源，见方案 §8.4.6 R-19），否则 CI 上跑不了 `run-parity`。

### 10.6 第 6 步：归档记录（每次发布填一行）

| 版本 | 日期 | 安装包大小 | 规则版本 | 门禁 | 装后验证 | 推送 | 备注 |
|---|---|---|---|---|---|---|---|
| 0.1.0 | 2026-11-01 | 2,171,674 B（v1.5） | yyb-2 | 493/493 | 5/5 | 未推送 | 无签名、WebView2 需联网下载 |

### 10.7 已知阻塞（发布前必读）

- **无网络**：本机当前访问 GitHub 超时，推送步骤停在此处，不代表流程有误。
- **无 `gh`**：GitHub CLI 未安装，发布 Release 需网页手工操作或先装 `gh`。
- **无签名**：0.1.x 不签名，SmartScreen 会告警（方案 §8.4.5，Q-08 待询价）。
- **WebView2**：`downloadBootstrapper` 模式下无 WebView2 的机器装不上（D-16 / Q-18）。


---

## 附：v1.7 目录迁移说明（2026-11-01）

- 本仓库已从「桌面端 + 零框架前端 `ui/`」改为**仅后端程序**：`ui/` 整体移除，改为最小壳页 `shell/`（`index.html` + `app.js` + `style.css`，可试校验，不是产品级界面）。
- 规格真源改为仓库内副本 `tools/parity/spec/yanyibian.js`（原跨仓库路径 `../验一遍/yanyibian.js` 已废弃）；`RULE_VERSION` 当时为 `yyb-2`（v1.7 起为 `yyb-3`，v1.8 起为 `yyb-4`）。
- 冒烟样本文档路径改为 `tools/parity/fixtures/smoke-weekly.txt`（原 `build/smoke-weekly.txt`，`build/` 已进 `.gitignore`）。
- 文中出现的 `<仓库根>`、`（待补充：…）` 是替换后的占位；绝对路径已全部去除。
- 文档中带行号的 `shell/*` 引用沿用 v1.6 的旧行号，v1.7 的壳页代码更短，行号可能偏移；判定逻辑不受影响。
