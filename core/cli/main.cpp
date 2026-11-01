/* yyb-cli —— 内核的命令行形态（方案 §2.3 的"测试形态"）
   用法：
     yyb-cli --version               打印规则版本
     yyb-cli --templates             打印四套模板约束 JSON
     yyb-cli --samples               打印三条示例 JSON
     yyb-cli <tpl> <text-file>       校验一个文本文件（UTF-8）
     yyb-cli --tab <file.tab>        逐行校验；每行 "模板ID<TAB>UTF-16LE十六进制"
   退出码：0 成功；2 用法错误；3 文件读取失败；4 未知模板。 */
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "yyb/yyb.h"

namespace {

bool read_file(const char* path, std::string& out) {
  FILE* f = std::fopen(path, "rb");
  if (f == nullptr) return false;
  char buf[65536];
  size_t n;
  while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
  std::fclose(f);
  return true;
}

int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

/* UTF-16LE 字节流的十六进制："4100" -> U+0041，"4e9b" -> U+9B4E
   低字节在前，所以每个四字符组是 [字节0高半字节][字节0低半字节][字节1高][字节1低]。
   代理对的两半各自编码为 WTF-8 三字节，经 yyb 的 utf8_to_u16 可无损还原。*/
std::string hex_to_utf8(const std::string& hex) {
  std::string out;
  for (size_t i = 0; i + 3 < hex.size(); i += 4) {
    int b0h = hexval(hex[i]);
    int b0l = hexval(hex[i + 1]);
    int b1h = hexval(hex[i + 2]);
    int b1l = hexval(hex[i + 3]);
    if (b0h < 0 || b0l < 0 || b1h < 0 || b1l < 0) continue;
    unsigned int byte0 = (unsigned int)((b0h << 4) | b0l);
    unsigned int byte1 = (unsigned int)((b1h << 4) | b1l);
    unsigned int u = byte0 | (byte1 << 8);
    if (u < 0x80) {
      out.push_back((char)u);
    } else if (u < 0x800) {
      out.push_back((char)(0xC0 | (u >> 6)));
      out.push_back((char)(0x80 | (u & 0x3F)));
    } else {
      out.push_back((char)(0xE0 | (u >> 12)));
      out.push_back((char)(0x80 | ((u >> 6) & 0x3F)));
      out.push_back((char)(0x80 | (u & 0x3F)));
    }
  }
  return out;
}

void print_and_free(char* p) {
  if (p == nullptr) {
    std::fputs("{\"error\":\"null\"}", stdout);
    std::fputc('\n', stdout);
    return;
  }
  std::fputs(p, stdout);
  std::fputc('\n', stdout);
  yyb_free(p);
}

} // namespace

int main(int argc, char** argv) {
  if (argc >= 2 && std::strcmp(argv[1], "--version") == 0) {
    std::printf("%s\n", yyb_rule_version());
    return 0;
  }
  if (argc >= 2 && std::strcmp(argv[1], "--templates") == 0) {
    print_and_free(yyb_list_templates_json());
    return 0;
  }
  if (argc >= 2 && std::strcmp(argv[1], "--samples") == 0) {
    print_and_free(yyb_list_samples_json());
    return 0;
  }
  if (argc >= 3 && std::strcmp(argv[1], "--tab") == 0) {
    std::string raw;
    if (!read_file(argv[2], raw)) return 3;
    size_t pos = 0;
    while (pos <= raw.size()) {
      size_t nl = raw.find('\n', pos);
      std::string line = (nl == std::string::npos) ? raw.substr(pos) : raw.substr(pos, nl - pos);
      if (!line.empty() && line.back() == '\r') line.pop_back();
      if (!line.empty()) {
        size_t tab = line.find('\t');
        if (tab == std::string::npos) return 2;
        std::string tpl = line.substr(0, tab);
        std::string hex = line.substr(tab + 1);
        std::string utf8 = hex_to_utf8(hex);
        char* out = yyb_check_json_n(utf8.data(), utf8.size(), tpl.c_str());
        if (out == nullptr) return 4;
        print_and_free(out);
      }
      if (nl == std::string::npos) break;
      pos = nl + 1;
    }
    return 0;
  }
  if (argc >= 3) {
    std::string raw;
    if (!read_file(argv[2], raw)) return 3;
    char* out = yyb_check_json_n(raw.data(), raw.size(), argv[1]);
    if (out == nullptr) return 4;
    print_and_free(out);
    return 0;
  }
  std::fprintf(stderr,
               "usage: yyb-cli --version | --templates | --samples | --tab <file.tab> | <tpl> <text-file>\n");
  return 2;
}
