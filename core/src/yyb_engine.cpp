#include "yyb_model.h"

#include <algorithm>
#include <string>

namespace yyb {
namespace {

const U16& lit_bang_full() {
  static const U16 v = u16_from_lit(u8"！");
  return v;
}
const U16& lit_bang_half() {
  static const U16 v = u16_from_lit(u8"!");
  return v;
}

Pattern& abs_pattern() {
  static Pattern p =
      compile_pattern(u8"(一定能|绝对|必然|百分之百|完全可以|彻底解决|前所未有的)");
  return p;
}

Pattern& quant_pattern() {
  static Pattern p = compile_pattern(
      u8"(\\d+(?:\\.\\d+)?\\s*%|提升\\s*\\d|增长\\s*\\d|降低\\s*\\d|提高了?\\s*\\d)");
  return p;
}

int sev_order(const std::string& sev) {
  if (sev == "high") return 0;
  if (sev == "mid") return 1;
  return 2;
}

void push_defect(std::vector<Defect>& v, const char* type, const char* sev,
                 const std::string& label, const std::string& explain,
                 long long start, long long end) {
  Defect d;
  d.type = type;
  d.sev = sev;
  d.label = label;
  d.explain = explain;
  d.start = start;
  d.end = end;
  v.push_back(d);
}

std::string num(long long v) { return std::to_string(v); }

} // namespace

CheckResult check(const U16& text, const CompiledTemplate& t) {
  CheckResult r;

  /* ---- 规则 yyb-2：空文本直接判 high，不再进入其余检查 ---- */
  r.chars = count_chars(text);
  if (r.chars == 0) {
    push_defect(r.defects, u8"格式", u8"high", u8"全文为空",
                u8"没有可校验的正文。请先把要交付的文本粘进来，再选模板重查。", -1, -1);
    return r;
  }

  /* ---- 4.1 长度 ---- */
  if (r.chars > t.max_chars) {
    long long over = r.chars - (long long)t.max_chars;
    std::string label = std::string(u8"超出 ") + num(over) + u8" 字";
    std::string explain = std::string(u8"模板上限 ") + num(t.max_chars) +
                          u8" 字，现在是 " + num(r.chars) +
                          u8" 字。超出部分通常没人读完，建议压缩到上限内。";
    push_defect(r.defects, u8"长度", u8"mid", label, explain,
                (long long)index_at_char_count(text, (long long)t.max_chars),
                (long long)text.size());
  } else {
    r.passes.push_back(std::string(u8"长度 ") + num(r.chars) + "/" + num(t.max_chars));
  }

  /* ---- 4.2 要素覆盖 ---- */
  for (const auto& req : t.required) {
    size_t ms = 0, me = 0;
    if (req.second.valid && req.second.search(text, 0, ms, me)) {
      r.required_hit++;
      r.passes.push_back(std::string(u8"要素·") + req.first);
    } else {
      std::string label = std::string(u8"缺「") + req.first + u8"」";
      std::string explain = std::string(u8"全文没有找到表示「") + req.first +
                            u8"」的内容。这一项没有可标注的原句，请自己补一段，不要用别的段落顶替。";
      push_defect(r.defects, u8"要素覆盖", u8"high", label, explain, -1, -1);
    }
  }

  /* ---- 4.3 禁用项 ---- */
  long long banned_hits = 0;
  for (const U16& word : t.banned) {
    std::string w = u16_to_utf8(word);
    std::vector<size_t> spots = find_all(text, word);
    for (size_t at : spots) {
      banned_hits++;
      std::string label = std::string(u8"套话「") + w + u8"」";
      push_defect(r.defects, u8"禁用项", u8"mid", label,
                  u8"换成具体做了什么、得到什么结果。套话在这里只占字数，不传递信息。",
                  (long long)at, (long long)(at + word.size()));
    }
  }
  if (banned_hits == 0) r.passes.push_back(u8"套话 0 处");

  /* ---- 4.4a 感叹号 ---- */
  std::vector<long long> bangs;
  for (size_t q : find_all(text, lit_bang_full())) bangs.push_back((long long)q);
  for (size_t q : find_all(text, lit_bang_half())) bangs.push_back((long long)q);
  std::sort(bangs.begin(), bangs.end());
  if ((int)bangs.size() > t.max_exclaim) {
    long long at = bangs[(size_t)t.max_exclaim];
    std::string label = std::string(u8"感叹号 ") + num((long long)bangs.size()) + u8" 个";
    std::string explain = std::string(u8"这套模板最多允许 ") + num(t.max_exclaim) +
                          u8" 个。交付文本里，情绪强度通常不承担信息。";
    push_defect(r.defects, u8"语气", u8"low", label, explain, at, at + 1);
  } else {
    r.passes.push_back(std::string(u8"感叹号 ") + num((long long)bangs.size()) + "/" +
                       num(t.max_exclaim));
  }

  /* ---- 4.4b 绝对化表述 ---- */
  size_t abs_n = abs_pattern().count(text);
  if (abs_n > 0) {
    size_t ms = 0, me = 0;
    abs_pattern().search(text, 0, ms, me);
    std::string label = std::string(u8"绝对化表述 ") + num((long long)abs_n) + u8" 处";
    push_defect(r.defects, u8"语气", u8"mid", label,
                u8"绝对化说法在评审和验收时最容易被追问「凭什么」。改成有条件的表述，或者补上证据。",
                (long long)ms, (long long)me);
  }

  /* ---- 4.5 段落 ---- */
  int paras = count_paras(text);
  if (paras < t.min_paras) {
    std::string label = std::string(u8"只有 ") + num(paras) + u8" 段";
    std::string explain = std::string(u8"这套模板至少要 ") + num(t.min_paras) +
                          u8" 段。整块文字读起来找不到结构，读者很难定位信息。";
    push_defect(r.defects, u8"格式", u8"low", label, explain, -1, -1);
  } else {
    r.passes.push_back(std::string(u8"段落 ") + num(paras));
  }

  /* ---- 4.6 量化断言 ---- */
  size_t quant_n = quant_pattern().count(text);
  if (quant_n > 0) {
    size_t ms = 0, me = 0;
    quant_pattern().search(text, 0, ms, me);
    std::string first = u16_to_utf8(trim(text.substr(ms, me - ms)));
    std::string label = std::string(u8"量化断言 ") + num((long long)quant_n) + u8" 处";
    std::string explain = std::string(u8"出现具体数字（如「") + first +
                          u8"」）但没有出处。交付前补一句口径：谁测的、样本多少、什么条件下。";
    push_defect(r.defects, u8"事实一致性", u8"mid", label, explain,
                (long long)ms, (long long)me);
  } else {
    r.passes.push_back(u8"无量化断言");
  }

  std::stable_sort(r.defects.begin(), r.defects.end(),
                   [](const Defect& a, const Defect& b) { return sev_order(a.sev) < sev_order(b.sev); });
  return r;
}

Verdict verdict_of(const std::vector<Defect>& defects) {
  Verdict v;
  int high = 0, mid = 0, low = 0;
  for (const Defect& d : defects) {
    if (d.sev == "high") high++;
    else if (d.sev == "mid") mid++;
    else low++;
  }
  v.high = high;
  v.mid = mid;
  v.low = low;
  if (high > 0) {
    v.cls = u8"is-bad";
    v.text = u8"不建议直接交付";
    v.why = std::string(u8"有 ") + num(high) + u8" 处需要先补内容，补完再交。";
  } else if (mid > 0) {
    v.cls = u8"is-warn";
    v.text = u8"建议改一遍再交";
    v.why = std::string(u8"没有缺项，但有 ") + num(mid) + u8" 处说法或长度值得修。";
  } else {
    v.cls = u8"is-ok";
    v.text = u8"可以交付";
    v.why = u8"这套模板的检查项都过了。事实出处仍需你自己确认。";
  }
  return v;
}

std::vector<Range> ranges_of(const U16& /*text*/, const std::vector<Defect>& defects) {
  std::vector<Range> picked;
  for (const Defect& d : defects) {
    if (d.start >= 0 && d.end > d.start) {
      picked.push_back(Range{d.start, d.end, d.sev, d.type, d.label});
    }
  }
  std::stable_sort(picked.begin(), picked.end(),
                   [](const Range& a, const Range& b) { return a.start < b.start; });
  std::vector<Range> out;
  for (const Range& g : picked) {
    if (!out.empty() && g.start < out.back().end) continue;
    out.push_back(g);
  }
  return out;
}

FormatResult format(const U16& text, const CompiledTemplate& t) {
  CheckResult c = check(text, t);
  FormatResult f;
  f.verdict = verdict_of(c.defects);
  f.chars = c.chars;
  f.defects = c.defects;
  f.passes = c.passes;
  f.required_hit = c.required_hit;
  f.ranges = ranges_of(text, c.defects);
  return f;
}

/* ---------------- JSON 输出（不依赖任何 JSON 库） ---------------- */
namespace {

const char Q = 0x22;   /* " */
const char BS = 0x5C;  /* backslash */

void quoted(std::string& o, const std::string& s) {
  o.push_back(Q);
  for (char ch : s) {
    unsigned char c = (unsigned char)ch;
    if (c == 0x22) { o.push_back(BS); o.push_back(Q); }
    else if (c == 0x5C) { o.push_back(BS); o.push_back(BS); }
    else if (c == 0x0A) { o.push_back(BS); o.push_back('n'); }
    else if (c == 0x0D) { o.push_back(BS); o.push_back('r'); }
    else if (c == 0x09) { o.push_back(BS); o.push_back('t'); }
    else if (c < 0x20) {
      const char* hex = "0123456789abcdef";
      o.push_back(BS); o.push_back('u'); o.push_back('0'); o.push_back('0');
      o.push_back(hex[(c >> 4) & 0xF]);
      o.push_back(hex[c & 0xF]);
    } else {
      o.push_back(ch);
    }
  }
  o.push_back(Q);
}

void key(std::string& o, const char* k) {
  o.push_back(Q);
  o += k;
  o.push_back(Q);
  o.push_back(':');
}

void sfield(std::string& o, const char* k, const std::string& v) {
  key(o, k);
  quoted(o, v);
}

void nfield(std::string& o, const char* k, long long v) {
  key(o, k);
  o += num(v);
}

} // namespace

std::string format_json(const FormatResult& r) {
  std::string o;
  o.reserve(1024);
  o.push_back('{');
  key(o, "verdict");
  o.push_back('{');
  sfield(o, "cls", r.verdict.cls);
  o.push_back(',');
  sfield(o, "text", r.verdict.text);
  o.push_back(',');
  sfield(o, "why", r.verdict.why);
  o.push_back(',');
  nfield(o, "high", r.verdict.high);
  o.push_back(',');
  nfield(o, "mid", r.verdict.mid);
  o.push_back(',');
  nfield(o, "low", r.verdict.low);
  o.push_back('}');
  o.push_back(',');
  nfield(o, "chars", r.chars);
  o.push_back(',');
  key(o, "defects");
  o.push_back('[');
  for (size_t i = 0; i < r.defects.size(); i++) {
    const Defect& d = r.defects[i];
    if (i) o.push_back(',');
    o.push_back('{');
    sfield(o, "type", d.type);
    o.push_back(',');
    sfield(o, "sev", d.sev);
    o.push_back(',');
    sfield(o, "label", d.label);
    o.push_back(',');
    sfield(o, "explain", d.explain);
    o.push_back(',');
    nfield(o, "start", d.start);
    o.push_back(',');
    nfield(o, "end", d.end);
    o.push_back('}');
  }
  o.push_back(']');
  o.push_back(',');
  key(o, "passes");
  o.push_back('[');
  for (size_t i = 0; i < r.passes.size(); i++) {
    if (i) o.push_back(',');
    quoted(o, r.passes[i]);
  }
  o.push_back(']');
  o.push_back(',');
  nfield(o, "requiredHit", r.required_hit);
  o.push_back(',');
  key(o, "ranges");
  o.push_back('[');
  for (size_t i = 0; i < r.ranges.size(); i++) {
    const Range& g = r.ranges[i];
    if (i) o.push_back(',');
    o.push_back('{');
    nfield(o, "start", g.start);
    o.push_back(',');
    nfield(o, "end", g.end);
    o.push_back(',');
    sfield(o, "sev", g.sev);
    o.push_back(',');
    sfield(o, "type", g.type);
    o.push_back(',');
    sfield(o, "label", g.label);
    o.push_back('}');
  }
  o.push_back(']');
  o.push_back('}');
  return o;
}

std::string templates_json() {
  std::string o = "[";
  const std::vector<CompiledTemplate>& v = templates();
  for (size_t i = 0; i < v.size(); i++) {
    const CompiledTemplate& t = v[i];
    if (i) o.push_back(',');
    o.push_back('{');
    sfield(o, "id", t.id);
    o.push_back(',');
    sfield(o, "label", t.label);
    o.push_back(',');
    sfield(o, "short", t.short_);
    o.push_back(',');
    sfield(o, "desc", t.desc);
    o.push_back(',');
    nfield(o, "maxChars", t.max_chars);
    o.push_back(',');
    nfield(o, "minParas", t.min_paras);
    o.push_back(',');
    nfield(o, "maxExclaim", t.max_exclaim);
    o.push_back(',');
    key(o, "required");
    o.push_back('[');
    for (size_t k = 0; k < t.required.size(); k++) {
      if (k) o.push_back(',');
      quoted(o, t.required[k].first);
    }
    o.push_back(']');
    o.push_back(',');
    key(o, "banned");
    o.push_back('[');
    for (size_t k = 0; k < t.banned.size(); k++) {
      if (k) o.push_back(',');
      quoted(o, u16_to_utf8(t.banned[k]));
    }
    o.push_back(']');
    o.push_back('}');
  }
  o.push_back(']');
  return o;
}

std::string samples_json() {
  std::string o = "[";
  const std::vector<Sample>& v = samples();
  for (size_t i = 0; i < v.size(); i++) {
    const Sample& s = v[i];
    if (i) o.push_back(',');
    o.push_back('{');
    sfield(o, "tpl", s.tpl);
    o.push_back(',');
    sfield(o, "title", s.title);
    o.push_back(',');
    sfield(o, "text", s.text);
    o.push_back('}');
  }
  o.push_back(']');
  return o;
}

} // namespace yyb
