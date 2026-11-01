#include "yyb_model.h"

namespace yyb {

/* yyb-3：新增第 5 套模板 agentcmd（只加模板，不改既有 4 套的判定）
   yyb-4：agentcmd 长度上限 1200 → 20000；示例每套补到 3 条（共 15 条） */
const char* rule_version() { return "yyb-4"; }

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

const ReqSrc CMD_REQ[] = {
    {u8"角色", u8"(角色|身份|你是|作为|担任)"},
    {u8"背景", u8"(背景|上下文|现状|起因|为什么|目前)"},
    {u8"步骤", u8"(步骤|流程|第[一二三四五六七八九十0-9]步|依次|逐个)"},
    {u8"约束与边界", u8"(约束|边界|禁止|不得|不要|只允许|上限|范围|白名单|黑名单)"},
    {u8"验收标准", u8"(验收|通过标准|判定标准|完成标准|自检|必须满足|检查项)"}};
/* 命令文本里的禁用项不是「套话」而是「模糊词」：让 Agent 自己拿主意的措辞 */
const char* const CMD_BAN[] = {u8"尽量", u8"大概", u8"差不多", u8"酌情",
                               u8"适当", u8"看情况", u8"有时间", u8"应该没问题"};

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
    {u8"agentcmd", u8"Agent 命令验收", u8"角色 / 背景 / 步骤 / 约束 / 验收",
     u8"验收一段交给 Agent 执行的命令：角色、背景、步骤、约束与边界、验收标准五个区块缺一不可。上限 20000 字（与输入硬上限一致，长度项实际不触发）。",
     20000, 5, 0, CMD_REQ, 5, CMD_BAN, 8},
};

const Sample SAMPLE_SRC[] = {
    {u8"weekly", u8"周报 · 缺风险段",
     u8"本周完成了数据采集脚本的重构，采集速度提升 40%，整体流程更加顺畅。\n下周计划把三条试点记录补齐，并同步更新标注规范。\n整个方案全面赋能后续实验，效率显著提升！"},
    {u8"weekly", u8"周报 · 合规",
     u8"本周完成采集脚本重构与三条试点记录入库，单次采集耗时从 42 分钟降到 26 分钟。\n下周计划补齐标注规范，并把试点扩到五个团队。\n目前的风险是标注人手不足，需要支持两名标注同学。"},
    {u8"weekly", u8"周报 · 套话与感叹号",
     u8"本周在各方支持下全面赋能数据链路，抓手明确，闭环顺畅！\n下周继续推进生态位建设，整体提升明显！"},
    {u8"notice", u8"通知 · 缺地点",
     u8"请全体成员于 11 月 9 日 24:00 前，把 30 条试点记录提交到共享表格，提交时务必核对字段是否齐全，缺项会被退回重填。"},
    {u8"notice", u8"通知 · 合规",
     u8"请全体成员于 11 月 9 日 14:00 到三楼会议室参加季度复盘，会前把本季度进展填进共享表格，无法参加的请提前一天在群里请假。"},
    {u8"notice", u8"通知 · 缺要求",
     u8"各位同学：11 月 9 日 14:00 在三楼会议室开季度复盘会，全体成员参加。"},
    {u8"readme", u8"项目说明 · 缺限制",
     u8"背景：团队每周要交付十几份材料，交付前没人愿意逐条自查。\n目标：把常见的四类问题在交出去之前提醒一遍。\n用法：打开客户端，选模板，粘文本，看结论。"},
    {u8"readme", u8"项目说明 · 合规",
     u8"背景：团队每周要交付十几份材料，交付前没人愿意逐条自查。\n目标：把常见的四类问题在交出去之前提醒一遍。\n用法：打开客户端，选模板，粘文本，看结论。\n限制：只做规则检查，不判断事实真假，也不自动改写句子。"},
    {u8"readme", u8"项目说明 · 套话",
     u8"这个项目完美解决了团队的自检问题，是行业领先的做法。\n目标：让交付前的自检变成一分钟的事。\n用法：运行客户端即可。\n限制：暂不支持 PDF 解析。"},
    {u8"general", u8"通用 · 套话与超长",
     u8"本项目致力于打造一体化解决方案，通过闭环设计全面赋能团队协作，是本领域唯一选择。\n我们相信这套抓手能够彻底解决沟通成本问题，让每个人都能百分之百专注在真正重要的事情上，从而在整体效率上取得前所未有的突破！！！"},
    {u8"general", u8"通用 · 合规",
     u8"这次把采集脚本按模块拆开，单次跑完从 42 分钟降到 26 分钟。\n下一步先补标注规范，再看试点团队的反馈决定是否扩到全量。"},
    {u8"general", u8"通用 · 绝对化表述",
     u8"这是目前唯一可行的方案，也是行业内最好的做法。\n我们已经彻底解决了所有已知问题，后续不需要再讨论。"},
    {u8"agentcmd", u8"命令验收 · 缺约束与边界",
     u8"角色：你是发布工程师，负责把 0.2.0 发到测试环境。\n背景：上一版发布漏了迁移脚本，回滚过一次。\n步骤：第一步先跑全量测试，第二步构建产物，第三步部署并按步骤尽量核对结果。\n验收标准：测试全绿、部署后接口返回 200。"},
    {u8"agentcmd", u8"命令验收 · 合规",
     u8"角色：你是发布工程师，负责把 0.2.0 发到测试环境。\n背景：上一版发布漏了迁移脚本，回滚过一次。\n步骤：第一步跑全量测试，第二步构建产物，第三步部署到测试集群。\n约束与边界：只允许改动 config 目录，禁止直接操作生产库，单次发布不超过 30 分钟。\n验收标准：测试全绿、部署后接口返回 200、回滚脚本可用。"},
    {u8"agentcmd", u8"命令验收 · 缺验收标准",
     u8"角色：你是数据标注助手，负责整理本周的试点记录。\n背景：上一批记录字段不齐，返工过一次。\n步骤：第一步读入记录，第二步补齐缺失字段，第三步导出到共享目录。\n约束与边界：只允许改动 record 目录，禁止修改原始文件。"}
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
