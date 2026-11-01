#include "yyb_text.h"

namespace yyb {

bool is_js_space(char16_t c) {
  switch (c) {
    case 0x0009: case 0x000A: case 0x000B: case 0x000C: case 0x000D:
    case 0x0020: case 0x00A0: case 0x1680: case 0x2028: case 0x2029:
    case 0x202F: case 0x205F: case 0x3000: case 0xFEFF:
      return true;
    default:
      break;
  }
  if (c >= 0x2000 && c <= 0x200A) return true;
  return false;
}

U16 utf8_to_u16(const std::string& s) {
  U16 out;
  out.reserve(s.size());
  size_t i = 0, n = s.size();
  while (i < n) {
    unsigned char b0 = (unsigned char)s[i];
    if (b0 < 0x80) { out.push_back((char16_t)b0); i++; continue; }
    unsigned int cp = 0; size_t need = 0;
    if ((b0 & 0xE0) == 0xC0) { cp = b0 & 0x1F; need = 1; }
    else if ((b0 & 0xF0) == 0xE0) { cp = b0 & 0x0F; need = 2; }
    else if ((b0 & 0xF8) == 0xF0) { cp = b0 & 0x07; need = 3; }
    else { out.push_back(0xFFFD); i++; continue; }
    bool ok = (i + need) < n;
    for (size_t k = 1; ok && k <= need; k++) {
      unsigned char bk = (unsigned char)s[i + k];
      if ((bk & 0xC0) != 0x80) { ok = false; break; }
      cp = (cp << 6) | (bk & 0x3F);
    }
    if (!ok) { out.push_back(0xFFFD); i++; continue; }
    i += need + 1;
    if (cp <= 0xFFFF) {
      out.push_back((char16_t)cp);
    } else {
      cp -= 0x10000;
      out.push_back((char16_t)(0xD800 + (cp >> 10)));
      out.push_back((char16_t)(0xDC00 + (cp & 0x3FF)));
    }
  }
  return out;
}

U16 u16_from_lit(const char* utf8) { return utf8_to_u16(std::string(utf8 ? utf8 : "")); }

std::string u16_to_utf8(const U16& s) {
  std::string out;
  out.reserve(s.size());
  size_t i = 0;
  while (i < s.size()) {
    unsigned int cp = s[i];
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < s.size()) {
      char16_t lo = s[i + 1];
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
        i += 2;
      } else { i++; }
    } else { i++; }
    if (cp < 0x80) { out.push_back((char)cp); }
    else if (cp < 0x800) {
      out.push_back((char)(0xC0 | (cp >> 6)));
      out.push_back((char)(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
      out.push_back((char)(0xE0 | (cp >> 12)));
      out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
      out.push_back((char)(0x80 | (cp & 0x3F)));
    } else {
      out.push_back((char)(0xF0 | (cp >> 18)));
      out.push_back((char)(0x80 | ((cp >> 12) & 0x3F)));
      out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
      out.push_back((char)(0x80 | (cp & 0x3F)));
    }
  }
  return out;
}

long long count_chars(const U16& s) {
  long long n = 0;
  for (size_t i = 0; i < s.size(); i++) if (!is_js_space(s[i])) n++;
  return n;
}

size_t index_at_char_count(const U16& s, long long n) {
  long long seen = 0;
  for (size_t i = 0; i < s.size(); i++) {
    if (is_js_space(s[i])) continue;
    seen++;
    if (seen > n) return i;
  }
  return s.size();
}

std::vector<size_t> find_all(const U16& s, const U16& word) {
  std::vector<size_t> out;
  if (word.empty()) return out;
  size_t from = 0;
  for (;;) {
    size_t at = s.find(word, from);
    if (at == U16::npos) break;
    out.push_back(at);
    from = at + word.size();
  }
  return out;
}

U16 trim(const U16& s) {
  size_t b = 0, e = s.size();
  while (b < e && is_js_space(s[b])) b++;
  while (e > b && is_js_space(s[e - 1])) e--;
  return s.substr(b, e - b);
}

int count_paras(const U16& s) {
  int n = 0;
  size_t i = 0;
  for (;;) {
    size_t start = i;
    while (i < s.size() && s[i] != 0x000A) i++;
    if (!trim(s.substr(start, i - start)).empty()) n++;
    if (i >= s.size()) break;
    while (i < s.size() && s[i] == 0x000A) i++;
    if (i >= s.size()) break;   /* 末尾换行导致最后一个空段，丢弃 */
  }
  return n;
}

} // namespace yyb
