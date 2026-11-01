/* ============================================================
   验一遍 YanYiBian —— C++ 规则内核 对外 C ABI
   ------------------------------------------------------------
   设计约束（见方案 §2.3）：
     · 只有纯计算：文本 + 模板 → 结论 / 缺陷 / 通过项，无 IO、无网络、无 UI。
     · 与 JS 规格真源 验一遍/yanyibian.js 逐键等价（由 tools/parity 门禁保证）。
     · 文本按 UTF-16 码元处理，与 JS 的 String 长度/下标语义同构。
   返回的 char* 一律为 UTF-8 JSON，调用方用 yyb_free 释放。
   ============================================================ */
#ifndef YYB_YYB_H
#define YYB_YYB_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 校验一段文本。text_utf8 以 NUL 结尾。返回 JSON（format() 结果）。 */
char* yyb_check_json(const char* text_utf8, const char* template_id);

/* 同上，但文本按长度传入（允许内含 NUL，Rust 侧用这个）。 */
char* yyb_check_json_n(const char* text_utf8, size_t text_len, const char* template_id);

/* 四套模板的约束定义 → JSON 数组 */
char* yyb_list_templates_json(void);

/* 三条示例文本 → JSON 数组 */
char* yyb_list_samples_json(void);

/* 规则版本号，例如 "yyb-2"（静态字符串，不要释放） */
const char* yyb_rule_version(void);

/* 释放内核返回的字符串 */
void yyb_free(char* p);

#ifdef __cplusplus
}
#endif
#endif /* YYB_YYB_H */
