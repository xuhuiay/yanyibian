# 验一遍 · 后端（判定内核 + Tauri 壳）

本仓库只存放「验一遍」的**后端程序**：C++17 判定内核 + Tauri 2 壳 + 命令层 + 差分门禁。
面向用户的完整界面不在本仓库；仓库只带一个**最小壳页** `shell/`，用于验证「C++ 内核 → C ABI → Tauri 命令」整条链路。

> 站点/前端内容已移出本仓库（历史仍保留在 Git 中，本地备份见 `_backup/`）。

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
