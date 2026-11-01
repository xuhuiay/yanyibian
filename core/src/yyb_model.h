#pragma once
/* 判定内核的数据模型：模板约束、缺陷、结论、区间 */
#include <string>
#include <vector>

#include "yyb_pattern.h"
#include "yyb_text.h"

namespace yyb {

/* 规则版本号。任何判定语义变更都必须同时递增它，并在两端一起改。
   yyb-1：初版（对应 验一遍/yanyibian.js 原始实现）
   yyb-2：空文本（非空白字符为 0）判为 high「全文为空」，不再进入其余检查 */
const char* rule_version();

struct Defect {
  std::string type;
  std::string sev;
  std::string label;
  std::string explain;
  long long start = -1;
  long long end = -1;
};

struct Verdict {
  std::string cls;
  std::string text;
  std::string why;
  int high = 0;
  int mid = 0;
  int low = 0;
};

struct Range {
  long long start = 0;
  long long end = 0;
  std::string sev;
  std::string type;
  std::string label;
};

struct CheckResult {
  std::vector<Defect> defects;
  std::vector<std::string> passes;
  long long chars = 0;
  int required_hit = 0;
};

struct FormatResult {
  Verdict verdict;
  long long chars = 0;
  std::vector<Defect> defects;
  std::vector<std::string> passes;
  int required_hit = 0;
  std::vector<Range> ranges;
};

struct CompiledTemplate {
  std::string id;
  std::string label;
  std::string short_;
  std::string desc;
  int max_chars = 0;
  int min_paras = 0;
  int max_exclaim = 0;
  std::vector<std::pair<std::string, Pattern>> required; /* name, 已编译正则 */
  std::vector<U16> banned;
};

struct Sample {
  std::string tpl;
  std::string title;
  std::string text;
};

const std::vector<CompiledTemplate>& templates();
const CompiledTemplate* find_template(const std::string& id);
const std::vector<Sample>& samples();

CheckResult check(const U16& text, const CompiledTemplate& t);
Verdict verdict_of(const std::vector<Defect>& defects);
std::vector<Range> ranges_of(const U16& text, const std::vector<Defect>& defects);
FormatResult format(const U16& text, const CompiledTemplate& t);

std::string format_json(const FormatResult& r);
std::string templates_json();
std::string samples_json();

} // namespace yyb
