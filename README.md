# 验一遍 · 后端（判定内核 + Tauri 壳）

本仓库只存放「验一遍」的**后端程序**：C++17 判定内核 + Tauri 2 壳 + 命令层 + 差分门禁。
面向用户的完整界面不在本仓库；仓库只带一个**最小壳页** `shell/`，用于验证「C++ 内核 → C ABI → Tauri 命令」整条链路。

> 站点/前端内容已移出本仓库（历史仍保留在 Git 中，本地备份见 `_backup/`）。

## 这是什么程序

**验一遍**是一个离线的中文文本交付前自检工具：把要发出去的周报 / 通知 / 项目说明 / 通用文档贴进来，选一个模板，立刻得到三档结论（不建议直接交付 / 建议改一遍再交 / 可以交付）和逐条缺陷——能定位的给出原文区间，能通过的给出通过项。

- **7 项机械检查**：长度、要素覆盖、套话、感叹号、绝对化表述、段落、量化断言（另有"全文为空"前置判定）。
- **4 套模板**：周报 300 字 / 通知 200 字 / 项目说明 500 字 / 通用 600 字，各自带必需要素与禁用词表。
- **纯本地**：不联网、不登录、不留历史；正文默认只在内存里过一遍。
- **判定只有一处实现**：C++17 内核 + Web 端规格副本，493 条语料逐键 deep-equal 门禁。

完整介绍（判定口径、模板阈值、用法、边界与已知限制）见 **[docs/introduction.md](docs/introduction.md)**。

## 结构

```
core/        C++17 判定内核（唯一实现）+ yyb-cli（表驱动门禁）
src-tauri/   Tauri 2 壳：commands / core_ffi / text_io / docx / limits / ai
shell/       最小壳页（index.html + app.js + style.css，零框架、零打包器）
tools/       parity 差分门禁（含规格副本 spec/yanyibian.js）、ai-mock、图标生成
scripts/     build-windows / build-bundle / test-windows / verify-all
docs/        build-and-run / parity / ai-api-rules
```

## 构建

```bat
scripts\build-windows.bat        :: 需 MSVC（vcvars64）+ cargo
scripts\build-bundle.bat         :: 打 NSIS 安装包，需 Tauri CLI 2.x
```

## 验收

```bat
scripts\verify-all.bat           :: 期望末行 ALL CHECKS PASSED，且 parity 493/493
scripts\test-windows.bat ai::    :: 3 个守卫单测
```

判定口径与一致性机制见 `docs/parity.md`；构建/运行/打包细节见 `docs/build-and-run.md`。

**规则版本**：`yyb-2`（改规则须同时改 C++ 与 `tools/parity/spec/yanyibian.js` 并递增）。
