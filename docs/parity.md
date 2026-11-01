# 验一遍 · 判定口径清单与一致性门禁（parity.md）

**适用版本**：0.1.0 / `RULE_VERSION = yyb-2`　**最后更新**：2026-11-01
**这份文档解决什么**：同一套判定要在两个实现里给出逐字相同的答案——浏览器里的 `tools/parity/spec/yanyibian.js`（JS 真源）和 C++ 内核 `core/src`（随 Tauri 桌面端编译）。本文把「一致」写成可执行的判据，而不是一句口号。

---

## 1. 真源与同步契约

| 项 | 约定 |
|---|---|
| 规格真源 | `tools/parity/spec/yanyibian.js`。判定语义只在这里定义；C++ 是它的逐键等价实现 |
| 版本号 | 文件内 `RULE_VERSION` 常量；C++ 侧 `yyb_rule_version()` 必须返回同一字符串，`run-parity.mjs` 会先比对，不一致直接判失败 |
| 改判定的流程 | ①改 JS ②同改 C++ ③递增 `RULE_VERSION` ④必要时补语料 ⑤`node tools/parity/gen-golden.mjs && node tools/parity/run-parity.mjs` 全绿 ⑥同步本文第 2 节 |
| 允许的差异 | 只有一处：`defects` 数组内同 severity 的条目顺序依赖实现的稳定性；门禁按「逐键 deep-equal」比较，因此仍要求顺序一致（JS `Array.prototype.sort` 在现代 V8 上是稳定排序，C++ 用 `std::stable_sort`） |

**为什么以 JS 为真源**：网站是既有交付物，用户看到的结论以它为准；先改 C++ 再回写 JS 会让线上页面在发布间隙里给出不同答案。

## 2. 判定口径清单（逐条对应实现）

### 2.1 字符计数 `countChars`
- 定义：`String(text).replace(/\s/g, "").length` —— 去掉所有空白字符后按 **UTF-16 码元**计数。
- 推论：一个 emoji（代理对）算 2 个字；全角空格 `U+3000`、`U+2028`/`U+2029`、零宽空格 `U+200B` 均由 `\s` 决定是否计入（V8 的 `\s` 覆盖 `U+FEFF`、`U+2028`、`U+3000`、`U+200B` 之外的空白集合，实现细节以语料为准）。
- C++ 侧必须用 UTF-16 码元计数，**不能**用 UTF-8 字节数或代码点（code point）数。

### 2.2 空文本（`yyb-2` 起）
- `chars === 0` → 只产出一条 `{type:"格式", sev:"high", label:"全文为空", start:-1, end:-1}`，**立即 return**，不再跑后面的检查，`passes` 为空数组。
- 这条替换了 `yyb-1` 的旧行为（旧版对空文本会落进「可以交付」）。

### 2.3 长度
- 判据：`chars > tpl.maxChars` → `{type:"长度", sev:"mid", label:"超出 N 字"}`，`N = chars - maxChars`；区间 `[indexAtCharCount(text, maxChars), text.length)`。
- `indexAtCharCount(text, n)`：返回「第 n 个非空白字符之后」的原始下标，用于把超限起点落在第一个该被删的字符上。
- 未超限时记一条通过项：`长度 {chars}/{maxChars}`。

### 2.4 要素覆盖
- 判据：`tpl.required[i].re.test(text)`。命中记通过项 `要素·{name}`；未命中记 `{type:"要素覆盖", sev:"high", label:"缺「{name}」", start:-1, end:-1}`。
- 缺项**没有原文区间**（`start = -1`），外壳不得据此画高亮；桌面端与 Web 端都在缺陷卡片里直接写「需要补一段」。
- `test()` 不得带 `g` 标志（否则 `lastIndex` 会跨调用残留）；C++ 用无状态匹配。

### 2.5 禁用项（套话）
- 判据：对 `tpl.banned` 每个词做**字面** `indexOf` 全量扫描（不是正则，不区分大小写以外的任何规则）。每个命中单独产出一条 `{type:"禁用项", sev:"mid", label:"套话「{word}」"}`，区间精确到该词。
- 无命中时记通过项 `套话 0 处`。

### 2.6 语气：感叹号
- 计数：`！`（U+FF01）与 `!`（U+0021）**合并**计数。
- 判据：`count > tpl.maxExclaim` → `{type:"语气", sev:"low", label:"感叹号 N 个"}`，区间指向**第 `maxExclaim+1` 个**感叹号（0-based 下标 = `bangs[maxExclaim]`，长度 1）。
- 否则记通过项 `感叹号 {n}/{maxExclaim}`。

### 2.7 语气：绝对化表述
- 正则：`/(一定能|绝对|必然|百分之百|完全可以|彻底解决|前所未有的)/g`。
- 有命中 → 一条 `{type:"语气", sev:"mid", label:"绝对化表述 N 处"}`，区间指向**首个**命中的起止。
- 无命中**不记通过项**（与 2.6 不同，这是既有行为，不改）。

### 2.8 格式：段落数
- 判据：`text.split(/\n+/).filter(p => p.trim().length > 0).length < tpl.minParas` → `{type:"格式", sev:"low", label:"只有 N 段", start:-1, end:-1}`。
- 否则记通过项 `段落 N`。

### 2.9 事实一致性：量化断言
- 正则：`/(\d+(?:\.\d+)?\s*%|提升\s*\d|增长\s*\d|降低\s*\d|提高了?\s*\d)/`（全局计数）。
- 有命中 → 一条 `{type:"事实一致性", sev:"mid", label:"量化断言 N 处"}`，区间指向首个命中。
- **只提醒，不判真假**：本工具不下「数字错」的结论，只要求在交付前补口径（谁测的、样本多少、什么条件）。

### 2.10 排序
- `defects` 按 `SEV_ORDER = {high:0, mid:1, low:2}` **稳定**排序；同类保持产出顺序（长度 → 要素 → 禁用项 → 感叹号 → 绝对化 → 段落 → 量化）。

### 2.11 结论 `verdictOf`

| 条件 | cls | text | why |
|---|---|---|---|
| `high > 0` | `is-bad` | 不建议直接交付 | 有 N 处需要先补内容，补完再交。 |
| `high = 0, mid > 0` | `is-warn` | 建议改一遍再交 | 没有缺项，但有 N 处说法或长度值得修。 |
| 全 0 | `is-ok` | 可以交付 | 这套模板的检查项都过了。事实出处仍需你自己确认。 |

### 2.12 定位区间 `ranges`
- 过滤 `start >= 0 && end > start`，按 `start` 升序，**重叠者丢弃后一个**（避免外壳画出嵌套高亮）。
- 元素形状：`{start, end, sev, type, label}`。

## 3. 编码通道（为什么两端不会因为编码走样）

| 通道 | 用法 | 关键约束 |
|---|---|---|
| 差分门禁（JS ↔ C++） | `build/cases.tab` 里文本写成 **UTF-16LE 码元的十六进制**；`yyb-cli --tab` 按码元还原 | 码元即语义单位，代理对两半各自穿越，不经过任何「非法序列」判断 |
| 应用内（Rust → C++） | `yyb_check_json_n(ptr, len, tpl)` 传 UTF-8，C++ 用 `utf8_to_u16()` 还原（对孤立代理接受 WTF-8 三字节形式） | Rust `String` 不可能含孤立代理；WTF-8 支持是为门禁通道共用同一还原函数 |
| 文件读入（GB18030 等） | `src-tauri/src/text_io.rs`：BOM(UTF-16LE/BE) → 严格 UTF-8 → GB18030 | 解码失败的上抛错误码，不静默替换字符 |

## 4. 语料与门禁

**语料**：`tools/parity/gen-corpus.mjs` 生成 `build/corpus.jsonl`，共 493 例，覆盖：

- 三条 SAMPLES × 4 模板（12）
- 8 种空白/边界：空串、纯空白、单换行、CRLF、连续空行、首尾空白、全角空格、零宽字符
- 长度边界：`maxChars-1 / maxChars / maxChars+1`，以及 5000 字超长
- 要素正则逐条扫描（四套模板的 `required` 各自单独缺失）
- 禁用词 × 模板全组合
- 感叹号 0..3 个
- 段落 1..4 段
- 量化/绝对化短语（含 `提升 40%`、`百分之百`、`彻底解决`）
- Unicode 夹具：代理对（emoji）、BOM、零宽空格、EM SPACE、`U+2028`
- 固定种子（20261101）随机文本 220 条 — 保证语料可复现，不随时间漂移

**金标准**：`gen-golden.mjs` 用 JS 真源算出 `expect`，写入 `build/golden.jsonl`。

**门禁**：`run-parity.mjs` 先比对 `yyb-cli --version` 与 `build/rulemeta.json` 的 `ruleVersion`，再逐例、**逐键 deep-equal** 比较 `defects / passes / chars / requiredHit / verdict / ranges`；首个差异会打印路径与两端取值。

**一键验收**：`scripts\verify-all.bat`（四步：生成语料 → 差分 → 构建应用 → 用 `yyb-check.exe` 冒烟）。

## 5. 明确不判定的内容（防止被当成万能校验）

- 不判事实真假与数据准确性（只提示「有数字但没出处」）。
- 不判语法、错别字、标点规范。
- 不做语义相似度 / 改写建议（语义通道见方案 §ADR-01-rev1，0.1.0 未实现）。
- 不判断是否由 AI 撰写。

## 6. 变更记录

| RULE_VERSION | 变更 | 影响面 |
|---|---|---|
| `yyb-1` | 初版六类检查 | — |
| `yyb-2` | 空文本单列 high「全文为空」（原会给出「可以交付」）；C++ 内核同步；语料新增空文本/纯空白用例；`hex_to_utf8` 改为按 UTF-16LE 小端拼码元 | 两端 + 门禁 + 语料 |

## 7. 读入层与内核无关（v1.3 追加）

差分门禁只覆盖 **`text`（UTF-8 字符串）→ 判定结果** 这一段。以下三层在 Rust 侧、**不在**内核，因此 493 例门禁不能证明它们正确，各自另有验收：

| 层 | 代码 | 与门禁的关系 | 验收方式 |
|---|---|---|---|
| 字节 → 文本 | `src-tauri/src/text_io.rs` | 门禁的输入是已解码的字符串，不经过这层 | 格式矩阵：UTF-8 / UTF-8 BOM / UTF-16LE / GB18030 / 空文件，均 chars=39 或 0（§2.4 的计数口径） |
| docx → 文本 | `src-tauri/src/docx.rs` | 同上 | 6 份 python-docx 样本与 `expected.json` 逐字比对 5/5；`yyb-check --dump` 复核 |
| 上限与文本判定 | `src-tauri/src/limits.rs` + `looks_like_text` | 属「接不接收」，不属「怎么判」 | 8.4 MB / 200,001 码元 / 205 份 / `rand.bin` 四个边界样本 |

**结论**：v1.3 的 docx 与上限改动**没有触碰** `core/`、`shell/` 的判定逻辑，`tools/parity` 也未改一行；`RULE_VERSION` 仍为 **yyb-2**，门禁复跑 493/493 全绿。若将来把解析也做成「内核能力」（例如 docx 表格结构影响字数），必须同步升版本并扩语料，不能沿用本文 §2 的口径。


---

## 附：v1.7 迁移说明（2026-11-01）

- 规格真源现为**本仓库内副本** `tools/parity/spec/yanyibian.js`（原 `../验一遍/yanyibian.js` 跨仓库路径已废弃）。三个脚本 `gen-corpus.mjs` / `gen-golden.mjs` / `rulemeta.mjs` 均改为读该路径。
- 同步义务不变：改规则时先改副本 → 升 `RULE_VERSION` → 同步 C++ → 扩语料 → 重算金标准 → `verify-all` 100% 绿。
- `ui/` 已移除，改为最小壳页 `shell/`；本文提到的 `ui/` 判断一律指「前端展示层」，与判定口径无关。
