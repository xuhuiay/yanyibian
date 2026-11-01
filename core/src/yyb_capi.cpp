#include "yyb/yyb.h"

#include <cstdlib>
#include <cstring>
#include <string>

#include "yyb_model.h"

namespace {

char* dup_utf8(const std::string& s) {
  char* p = static_cast<char*>(std::malloc(s.size() + 1));
  if (p == nullptr) return nullptr;
  if (!s.empty()) std::memcpy(p, s.data(), s.size());
  p[s.size()] = 0;
  return p;
}

} // namespace

extern "C" {

char* yyb_check_json_n(const char* text_utf8, size_t text_len, const char* template_id) {
  const yyb::CompiledTemplate* t = yyb::find_template(std::string(template_id ? template_id : ""));
  if (t == nullptr) return nullptr; /* 未知模板：由调用方（Rust 外壳）映射为 E_TEMPLATE */
  std::string raw = (text_utf8 != nullptr) ? std::string(text_utf8, text_len) : std::string();
  yyb::U16 text = yyb::utf8_to_u16(raw);
  return dup_utf8(yyb::format_json(yyb::format(text, *t)));
}

char* yyb_check_json(const char* text_utf8, const char* template_id) {
  const char* s = text_utf8 ? text_utf8 : "";
  return yyb_check_json_n(s, std::strlen(s), template_id);
}

char* yyb_list_templates_json(void) { return dup_utf8(yyb::templates_json()); }

char* yyb_list_samples_json(void) { return dup_utf8(yyb::samples_json()); }

const char* yyb_rule_version(void) { return yyb::rule_version(); }

void yyb_free(char* p) { std::free(p); }

} // extern "C"
