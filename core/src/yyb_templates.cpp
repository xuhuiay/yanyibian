#include "yyb_model.h"

namespace yyb {

const char* rule_version() { return "yyb-2"; }

namespace {

struct ReqSrc { const char* name; const char* re; };

struct TplSrc {
  const char* id;
  const char* label;
  const char* short_;
  const char* desc;
  int max_chars;
  int min_paras;
  int max_exclaim;
  const ReqSrc* required;
  int required_n;
  const char* const* banned;
  int banned_n;
};

const ReqSrc WEEKLY_REQ[] = {
    {u8"进度", u8"(进度|进展|已完成|完成|做完)"},
    {u8"计划", u8"(计划|下一步|下周|明天|接下来|准备)"},
    {u8"风险", u8"(风险|问题|阻塞|卡点|阻塞项|需要支持|隐患)"},
};
const char* const WEEKLY_BAN[] = {u8"赋能", u8"闭环", u8"抓手", u8"生态位",
                                  u8"一体化解决方案", u8"全面提升", u8"协同增效"};

const ReqSrc NOTICE_REQ[] = {
    {u8"时间", u8"(\\d{1,2}\\s*[月\\/\\-]\\s*\\d{1,2}|\\d{1,2}[:：]\\d{2}|周[一二三四五六日天末]|今天|明天|后天|本周)"},
    {u8"地点", u8"(楼|室|厅|馆|地点|地址|线上|腾讯会议|会议室|教室)"},
    {u8"对象", u8"(全体|各位|同学们|成员|部门|参加|参会|报名)"},
    {u8"要求", u8"(请|须|务必|截止|需要|携带|提交|填写)"},
};
const char* const NOTICE_BAN[] = {u8"赋能", u8"闭环", u8"抓手"};

const ReqSrc README_REQ[] = {
    {u8"背景", u8"(背景|问题|现状|为什么|起因)"},
    {u8"目标", u8"(目标|目的|要解决|做到|希望)"},
    {u8"用法", u8"(使用|用法|步骤|运行|怎么用|安装|打开)"},
    {u8"限制", u8"(限制|风险|已知问题|注意|暂不支持|待补充)"},
};
const char* const README_BAN[] = {u8"颠覆", u8"革命性", u8"行业领先", u8"唯一选择", u8"完美解决"};

const char* const GENERAL_BAN[] = {u8"赋能", u8"闭环", u8"抓手", u8"生态位",
                                   u8"全面提升", u8"颠覆", u8"革命性"};

const TplSrc TPL_SRC[] = {
    {u8"weekly", u8"周报", u8"进度 / 计划 / 风险",
     u8"周报要能被别人接着做事：做了什么、接下来做什么、卡在哪里。上限 300 字。",
     300, 2, 1, WEEKLY_REQ, 3, WEEKLY_BAN, 7},
    {u8"notice", u8"通知公告", u8"时间 / 地点 / 对象 / 要求",
     u8"通知的四件事缺一件就会有人来问：什么时候、在哪里、谁参加、要做什么。上限 200 字。",
     200, 1, 2, NOTICE_REQ, 4, NOTICE_BAN, 3},
    {u8"readme", u8"项目说明", u8"背景 / 目标 / 用法 / 限制",
     u8"别人第一次打开你的仓库时想知道：为什么做、做到什么程度、怎么跑起来、有什么坑。上限 500 字。",
     500, 2, 0, README_REQ, 4, README_BAN, 5},
    {u8"general", u8"通用交付", u8"长度 / 语气 / 套话 / 结构",
     u8"不确定属于哪一类时用这套：只查长度、语气、套话、段落结构和量化断言。上限 600 字。",
     600, 2, 1, nullptr, 0, GENERAL_BAN, 7},
};

const Sample SAMPLE_SRC[] = {
    {u8"weekly", u8"周报 · 缺风险段",
     u8"本周完成了数据采集脚本的重构，采集速度提升 40%，整体流程更加顺畅。\n下周计划把三条试点记录补齐，并同步更新标注规范。\n整个方案全面赋能后续实验，效率显著提升！"},
    {u8"notice", u8"通知 · 缺地点",
     u8"请全体成员于 11 月 9 日 24:00 前，把 30 条试点记录提交到共享表格，提交时务必核对字段是否齐全，缺项会被退回重填。"},
    {u8"general", u8"通用 · 套话与超长",
     u8"本项目致力于打造一体化解决方案，通过闭环设计全面赋能团队协作，是本领域唯一选择。\n我们相信这套抓手能够彻底解决沟通成本问题，让每个人都能百分之百专注在真正重要的事情上，从而在整体效率上取得前所未有的突破！！！"},
};

std::vector<CompiledTemplate> build() {
  std::vector<CompiledTemplate> out;
  for (const TplSrc& s : TPL_SRC) {
    CompiledTemplate t;
    t.id = s.id;
    t.label = s.label;
    t.short_ = s.short_;
    t.desc = s.desc;
    t.max_chars = s.max_chars;
    t.min_paras = s.min_paras;
    t.max_exclaim = s.max_exclaim;
    for (int i = 0; i < s.required_n; i++) {
      t.required.push_back(std::make_pair(std::string(s.required[i].name),
                                          compile_pattern(std::string(s.required[i].re))));
    }
    for (int i = 0; i < s.banned_n; i++) t.banned.push_back(u16_from_lit(s.banned[i]));
    out.push_back(t);
  }
  return out;
}

const std::vector<CompiledTemplate>& g_templates() {
  static const std::vector<CompiledTemplate> v = build();
  return v;
}

const std::vector<Sample>& g_samples() {
  static const std::vector<Sample> v = [] {
    std::vector<Sample> out;
    for (const Sample& s : SAMPLE_SRC) out.push_back(s);
    return out;
  }();
  return v;
}

} // namespace

const std::vector<CompiledTemplate>& templates() { return g_templates(); }

const std::vector<Sample>& samples() { return g_samples(); }

const CompiledTemplate* find_template(const std::string& id) {
  const std::vector<CompiledTemplate>& v = g_templates();
  for (const CompiledTemplate& t : v) {
    if (t.id == id) return &t;
  }
  return nullptr;
}

} // namespace yyb
