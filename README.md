# 验一遍

**交付前先验一遍。** 一个离线的中文文本自检工具：把要发出去的**周报 / 通知公告 / 项目说明 / 通用文档**贴进来，选一个模板，立刻拿到三档结论与逐条可定位的修改点。

> 纯本地计算 —— 不联网、不登录、不上传正文、不留历史。

本仓库存放它的**后端程序**：C++17 判定内核 + Tauri 2 壳 + 命令层 + 差分门禁，外加一个用于端到端验证链路的最小壳页 `shell/`（面向日常使用的完整界面不属于本仓库）。

## 它解决什么问题

正式文字交付前的返工，通常不是错别字，而是这四类问题：

| 问题 | 例子 | 验一遍怎么管 |
|---|---|---|
| 该说的没说 | 周报没有风险段、通知没有地点 | **要素覆盖**（模板必需要素，缺则 high） |
| 说了但不承载信息 | "全面赋能""打造闭环""唯一选择" | **禁用项**：按模板词表逐处扫描并定位 |
| 说法站不住 | "提升 40%" 无口径、"彻底解决""百分之百" | **量化断言**（有数字无出处）+ **绝对化表述** |
| 形态不对 | 超长没人读完、整块不分段、感叹号当标点用 | **长度 / 段落 / 感叹号**，阈值按模板给 |

拼写检查与语法检查都不管这些。验一遍把它们做成可执行的判定：**同一模板 + 同一段文本 = 逐字节相同的结果**，结论只有三档，改哪一句一眼可见。

## 特性

- **7 项机械检查 + 1 个前置**：长度、要素覆盖、套话、感叹号、绝对化表述、段落、量化断言；空文本单列 high 并短路。
- **5 套模板**（判定阈值即规则）：周报 300 字 / 通知 200 字 / 项目说明 500 字 / 通用 600 字 / Agent 命令验收 20000 字，各自带必需要素与禁用词表。
- **三档结论**：不建议直接交付（有 high）/ 建议改一遍再交（有 mid）/ 可以交付；同时返回"已通过哪几条"。
- **能定位就定位**：缺陷带原文区间，可在界面里直接选中对应句子。
- **中文文件读得进来**：`.txt` / `.md` / `.docx`，编码自动识别（UTF-16 BOM → 严格 UTF-8 → GB18030）。
- **单份 20,000 字、批量 200 份**；单文件 8 MB、批量 200 MB，超限给可读错误码。
- **可选 AI 修改通道**：用户自带 API Key、默认关闭、关闭时零外联；改动经本地守卫（默认不许改数字）、改完重新校验；结果不计入结论。壳页「AI 修改（可选）」区块可直接填配置并生成修改稿。
- **随机示例**：5 套模板各 3 条内置示例（共 15 条），点「随机示例」抽一条试跑，连续两次不重复。
- **判定只有一处实现**：C++17 内核 + Web 端规格副本，**593 条语料逐键 deep-equal** 门禁，规则改动须同步两处并递增 `RULE_VERSION`（当前 `yyb-4`）。

完整介绍（检查项口径、模板阈值、13 个命令、读入层、边界与已知限制）见 **[docs/introduction.md](docs/introduction.md)**。

## 快速开始

```bat
:: 1. 构建（需要 MSVC：vcvars64 + cargo）
scripts\build-windows.bat

:: 2. 图形界面（仓库自带的最小壳页 shell/，含随机示例与 AI 入口）
src-tauri\target\release\yanyibian.exe

:: 3. 命令行（无窗口，适合 CI / 自检 / 排障）
src-tauri\target\release\yyb-check.exe --version
src-tauri\target\release\yyb-check.exe weekly 周报.txt

:: 4. 对外 HTTP 接口（给外部程序调用，见 docs/api.md）
set YYB_API_TOKEN=tok-abc
src-tauri\target\release\yyb-api.exe
:: GET /v1/health  POST /v1/points  →  points[] / review / verdict
```

打安装包（NSIS，装到用户目录、免管理员）：

```bat
scripts\build-bundle.bat
:: 产物 src-tauri\target\release\bundle\nsis\YanYiBian_0.1.0_x64-setup.exe
```

## 验收（改判定逻辑前后都要跑）

```bat
scripts\verify-all.bat           :: 期望末行 ALL CHECKS PASSED，且 parity 593/593
scripts\test-windows.bat ai::    :: 3 个守卫单测
```

**一致性门禁**：`tools/parity` 用固定种子生成 593 条语料（五模板示例、8 种空白形态、长度边界、要素正则扫描、禁用词/感叹号/段落/量化短语、代理对/BOM/零宽/U+2028、220 条随机文本），逐键比对 C++ 内核与 `tools/parity/spec/yanyibian.js`（Web 端规格副本），要求 100% 全绿。不一致时打印首个差异路径与两端值。

## 结构

```
core/        C++17 判定内核（唯一实现，无 IO、无全局状态）+ yyb-cli（表驱动门禁）
  include/   对外头文件（yyb_model.h）
  src/       text / pattern(MiniRE) / templates / engine / capi
  sources.txt 源清单唯一真源（CMake 与 build.rs 共用）
src-tauri/   Tauri 2 壳
  src/commands.rs  IO 与整形、批量、上限
  src/text_io.rs   字节 → 文本（UTF-16/UTF-8/GB18030）
  src/docx.rs      .docx 正文抽取
  src/core_ffi.rs  C ABI 绑定
  src/limits.rs    硬上限（一个真源、五处生效）
  src/ai.rs        可选 AI 修改通道
  src/bin/yyb_check.rs  命令行校验器
shell/       最小壳页（index.html + app.js + style.css，零框架、零打包器）
tools/       parity 差分门禁（含 spec/yanyibian.js）、ai-mock、图标生成
scripts/     build-windows / build-bundle / test-windows / verify-all
docs/        introduction / template-agent-command / build-and-run / parity / ai-api-rules / api
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/introduction.md](docs/introduction.md) | 程序介绍：定位、检查项、模板、结论、用法、读入层、边界、示例、已知限制 |
| [docs/build-and-run.md](docs/build-and-run.md) | 构建、运行、打包、安装、排障、更新发布清单 |
| [docs/parity.md](docs/parity.md) | 判定口径逐条实现细节与 593 例门禁 |
| [docs/template-agent-command.md](docs/template-agent-command.md) | 第 5 套模板 `agentcmd`（Agent 命令验收）：五区块骨架、判定映射、范例、实施清单 |
| [docs/ai-api-rules.md](docs/ai-api-rules.md) | AI 通道的权限范围、鉴权、配额、错误码、隐私 |
| [docs/api.md](docs/api.md) | 对外 HTTP 接口 `yyb-api`：`GET /v1/health`、`POST /v1/points`、字段语义、错误码、调用示例 |

## 关于本仓库

- **范围**：只有后端与最小壳页。站点/前端内容已移出（历史保留在 Git 中，本地备份见 `_backup/`）。
- **平台**：Windows 10 1809+ / Windows 11 x64（NSIS 安装包，`currentUser` 模式，免管理员）；移动端待定。
- **第三方**：C++ 侧零第三方依赖（自研 MiniRE 正则子集）；Rust 侧 tauri 2 / quick-xml / zip / encoding_rs / reqwest（仅 AI 通道）。
- **规则版本**：`yyb-4`。改规则必须同时改 C++ 内核与 `tools/parity/spec/yanyibian.js`，递增版本号，并让 593 例全绿。

---

**规则版本** `yyb-4` · 判定内核 C++17（`core/`） · 外壳 Tauri 2（`src-tauri/`）
