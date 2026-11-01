#pragma once
/* ------------------------------------------------------------
   MiniRE —— 只覆盖本内核用到的正则子集的最小回溯引擎
   ------------------------------------------------------------
   为什么不用 std::regex / PCRE2：
     · 判定内核只需要 8 个固定模式（见 yyb_templates.cpp），
       全部落在「字面量 / 字符类 / 分组 / 交替 / 量词」范围内；
     · 三平台（MSVC / clang / NDK clang）零第三方依赖，交叉编译不需要
       额外源码树，也不用维护 PCRE2 的 per-platform 编译分支；
     · 与 JS 的一致性不靠"相信"，靠差分门禁：tools/parity/fuzz-regex.mjs
       用随机串对每个模式逐串比对 JS RegExp 与本引擎的结果。
   语义约定：回溯、最左优先、贪婪量词、交替按书写顺序取首个成功分支，
   与 ECMAScript 在这些模式上一致。
   ------------------------------------------------------------ */
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "yyb_text.h"

namespace yyb {

struct Pattern {
  struct Node {
    enum Kind { LIT = 0, ANY, CLS, GRP, ALT, SEQ, REP };
    Kind kind = LIT;
    char16_t lit = 0;
    bool negate = false;
    std::vector<char16_t> singles;
    std::vector<std::pair<char16_t, char16_t>> ranges;
    std::vector<std::shared_ptr<Node>> kids;
    int min_rep = 0;
    int max_rep = 0; /* -1 表示无上限 */
    bool in_class(char16_t c) const;
  };

  std::shared_ptr<Node> root;
  bool valid = false;

  bool test(const U16& s) const;
  bool search(const U16& s, size_t from, size_t& ms, size_t& me) const;
  size_t count(const U16& s) const;
};

Pattern compile_pattern(const std::string& utf8_pattern);
Pattern compile_pattern_u16(const U16& pattern);

} // namespace yyb
