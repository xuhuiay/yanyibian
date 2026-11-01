#pragma once
/* UTF-16 码元级文本工具：与 ECMAScript 语义对齐的最小集合 */
#include <string>
#include <vector>

namespace yyb {

using U16 = std::u16string;

/* ECMAScript WhiteSpace + LineTerminator，即 JS 正则 \s 与 String.prototype.trim 的口径 */
bool is_js_space(char16_t c);

U16 utf8_to_u16(const std::string& s);
U16 u16_from_lit(const char* utf8);
std::string u16_to_utf8(const U16& s);

/* 非空白字符个数（码元计数，与 JS 的 replace(/\s/g,"").length 一致） */
long long count_chars(const U16& s);

/* 第 n 个非空白字符所在的码元下标；不足则返回 s.size() */
size_t index_at_char_count(const U16& s, long long n);

/* 子串全部出现位置（不重叠，与 JS indexOf 循环一致） */
std::vector<size_t> find_all(const U16& s, const U16& word);

U16 trim(const U16& s);

/* 段落数：按 /\n+/ 切分、逐段 trim、丢弃空段 */
int count_paras(const U16& s);

} // namespace yyb
