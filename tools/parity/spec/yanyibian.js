/* ============================================================
   验一遍 YanYiBian —— 规则内核（与外壳无关）
   ============================================================

   这个文件不是一个页面脚本，而是两个外壳共用的同一套判断：

     · Web 版        浏览器里直接跑，单篇即时校验
     · 桌面客户端     Tauri 打包的独立应用，规则同样在本地跑，
                     面向批量文件与不出网的场合

   所以这里只有纯计算：文本 + 模板 → 结论 / 缺陷 / 通过项。没有 DOM
   查询、没有事件绑定、没有渲染、没有网络请求。怎么画（标红、列表、
   一行解释）由外壳自己决定；两个外壳引用同一份文件，结论就不会因为
   入口不同而不一致。

   对外接口（UMD：浏览器挂 window.YanYiBian，Node/打包器走 module.exports）：

     YanYiBian.TEMPLATES          五套模板的约束定义
     YanYiBian.SAMPLES            四条示例文本（自测与演示用）
     YanYiBian.SEV_LABEL          严重度中文名
     YanYiBian.check(text, tpl)   → { defects, passes, chars, requiredHit }
     YanYiBian.verdictOf(defects) → { cls, text, why, high, mid, low }
     YanYiBian.ranges(text, defects) → [{ start, end, sev, type, label }]
     YanYiBian.format(text, tpl)  → 上面几项打包成一次调用的结果

   ranges() 只给字符区间（缺要素这类没有原句可标的缺陷 start = -1），
   外壳拿到区间自己上色：Web 版包 <mark>，桌面端画高亮段落。

   规则版本 RULE_VERSION：本文件是**规格真源**（桌面端方案 ADR-02）。C++ 内核
   逐键对齐本文件的输出（defects / passes / chars / requiredHit / ranges /
   verdict），改判定必须两端同改并递增 RULE_VERSION。

   一致性命门：yanyibian-app/tools/parity（金标准 golden.jsonl + 逐键 deep-equal），
   任何一端改动都要重跑 gen-golden.mjs 与 run-parity.mjs。
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (typeof define === "function" && define.amd) define([], function () { return api; });
  if (root) root.YanYiBian = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------------- 1. 约束模板 ---------------- */

  var TEMPLATES = {
    weekly: {
      label: "周报",
      short: "进度 / 计划 / 风险",
      desc: "周报要能被别人接着做事：做了什么、接下来做什么、卡在哪里。上限 300 字。",
      maxChars: 300,
      minParas: 2,
      required: [
        { name: "进度", re: /(进度|进展|已完成|完成|做完)/ },
        { name: "计划", re: /(计划|下一步|下周|明天|接下来|准备)/ },
        { name: "风险", re: /(风险|问题|阻塞|卡点|阻塞项|需要支持|隐患)/ }
      ],
      banned: ["赋能", "闭环", "抓手", "生态位", "一体化解决方案", "全面提升", "协同增效"],
      maxExclaim: 1
    },
    notice: {
      label: "通知公告",
      short: "时间 / 地点 / 对象 / 要求",
      desc: "通知的四件事缺一件就会有人来问：什么时候、在哪里、谁参加、要做什么。上限 200 字。",
      maxChars: 200,
      minParas: 1,
      required: [
        { name: "时间", re: /(\d{1,2}\s*[月\/\-]\s*\d{1,2}|\d{1,2}[:：]\d{2}|周[一二三四五六日天末]|今天|明天|后天|本周)/ },
        { name: "地点", re: /(楼|室|厅|馆|地点|地址|线上|腾讯会议|会议室|教室)/ },
        { name: "对象", re: /(全体|各位|同学们|成员|部门|参加|参会|报名)/ },
        { name: "要求", re: /(请|须|务必|截止|需要|携带|提交|填写)/ }
      ],
      banned: ["赋能", "闭环", "抓手"],
      maxExclaim: 2
    },
    readme: {
      label: "项目说明",
      short: "背景 / 目标 / 用法 / 限制",
      desc: "别人第一次打开你的仓库时想知道：为什么做、做到什么程度、怎么跑起来、有什么坑。上限 500 字。",
      maxChars: 500,
      minParas: 2,
      required: [
        { name: "背景", re: /(背景|问题|现状|为什么|起因)/ },
        { name: "目标", re: /(目标|目的|要解决|做到|希望)/ },
        { name: "用法", re: /(使用|用法|步骤|运行|怎么用|安装|打开)/ },
        { name: "限制", re: /(限制|风险|已知问题|注意|暂不支持|待补充)/ }
      ],
      banned: ["颠覆", "革命性", "行业领先", "唯一选择", "完美解决"],
      maxExclaim: 0
    },
    general: {
      label: "通用交付",
      short: "长度 / 语气 / 套话 / 结构",
      desc: "不确定属于哪一类时用这套：只查长度、语气、套话、段落结构和量化断言。上限 600 字。",
      maxChars: 600,
      minParas: 2,
      required: [],
      banned: ["赋能", "闭环", "抓手", "生态位", "全面提升", "颠覆", "革命性"],
      maxExclaim: 1
    },
    agentcmd: {
      label: "Agent 命令验收",
      short: "角色 / 背景 / 步骤 / 约束 / 验收",
      desc: "验收一段交给 Agent 执行的命令：角色、背景、步骤、约束与边界、验收标准五个区块缺一不可。上限 20000 字（与输入硬上限一致，长度项实际不触发）。",
      maxChars: 20000,
      minParas: 5,
      required: [
        { name: "角色", re: /(角色|身份|你是|作为|担任)/ },
        { name: "背景", re: /(背景|上下文|现状|起因|为什么|目前)/ },
        { name: "步骤", re: /(步骤|流程|第[一二三四五六七八九十0-9]步|依次|逐个)/ },
        { name: "约束与边界", re: /(约束|边界|禁止|不得|不要|只允许|上限|范围|白名单|黑名单)/ },
        { name: "验收标准", re: /(验收|通过标准|判定标准|完成标准|自检|必须满足|检查项)/ }
      ],
      banned: ["尽量", "大概", "差不多", "酌情", "适当", "看情况", "有时间", "应该没问题"],
      maxExclaim: 0
    }
  };

  /* ---------------- 2. 示例文本 ---------------- */

  var SAMPLES = [
    {
      tpl: "weekly",
      title: "周报 · 缺风险段",
      text: "本周完成了数据采集脚本的重构，采集速度提升 40%，整体流程更加顺畅。\n下周计划把三条试点记录补齐，并同步更新标注规范。\n整个方案全面赋能后续实验，效率显著提升！"
    },
    {
      tpl: "weekly",
      title: "周报 · 合规",
      text: "本周完成采集脚本重构与三条试点记录入库，单次采集耗时从 42 分钟降到 26 分钟。\n下周计划补齐标注规范，并把试点扩到五个团队。\n目前的风险是标注人手不足，需要支持两名标注同学。"
    },
    {
      tpl: "weekly",
      title: "周报 · 套话与感叹号",
      text: "本周在各方支持下全面赋能数据链路，抓手明确，闭环顺畅！\n下周继续推进生态位建设，整体提升明显！"
    },
    {
      tpl: "notice",
      title: "通知 · 缺地点",
      text: "请全体成员于 11 月 9 日 24:00 前，把 30 条试点记录提交到共享表格，提交时务必核对字段是否齐全，缺项会被退回重填。"
    },
    {
      tpl: "notice",
      title: "通知 · 合规",
      text: "请全体成员于 11 月 9 日 14:00 到三楼会议室参加季度复盘，会前把本季度进展填进共享表格，无法参加的请提前一天在群里请假。"
    },
    {
      tpl: "notice",
      title: "通知 · 缺要求",
      text: "各位同学：11 月 9 日 14:00 在三楼会议室开季度复盘会，全体成员参加。"
    },
    {
      tpl: "readme",
      title: "项目说明 · 缺限制",
      text: "背景：团队每周要交付十几份材料，交付前没人愿意逐条自查。\n目标：把常见的四类问题在交出去之前提醒一遍。\n用法：打开客户端，选模板，粘文本，看结论。"
    },
    {
      tpl: "readme",
      title: "项目说明 · 合规",
      text: "背景：团队每周要交付十几份材料，交付前没人愿意逐条自查。\n目标：把常见的四类问题在交出去之前提醒一遍。\n用法：打开客户端，选模板，粘文本，看结论。\n限制：只做规则检查，不判断事实真假，也不自动改写句子。"
    },
    {
      tpl: "readme",
      title: "项目说明 · 套话",
      text: "这个项目完美解决了团队的自检问题，是行业领先的做法。\n目标：让交付前的自检变成一分钟的事。\n用法：运行客户端即可。\n限制：暂不支持 PDF 解析。"
    },
    {
      tpl: "general",
      title: "通用 · 套话与超长",
      text: "本项目致力于打造一体化解决方案，通过闭环设计全面赋能团队协作，是本领域唯一选择。\n我们相信这套抓手能够彻底解决沟通成本问题，让每个人都能百分之百专注在真正重要的事情上，从而在整体效率上取得前所未有的突破！！！"
    },
    {
      tpl: "general",
      title: "通用 · 合规",
      text: "这次把采集脚本按模块拆开，单次跑完从 42 分钟降到 26 分钟。\n下一步先补标注规范，再看试点团队的反馈决定是否扩到全量。"
    },
    {
      tpl: "general",
      title: "通用 · 绝对化表述",
      text: "这是目前唯一可行的方案，也是行业内最好的做法。\n我们已经彻底解决了所有已知问题，后续不需要再讨论。"
    },
    {
      tpl: "agentcmd",
      title: "命令验收 · 缺约束与边界",
      text: "角色：你是发布工程师，负责把 0.2.0 发到测试环境。\n背景：上一版发布漏了迁移脚本，回滚过一次。\n步骤：第一步先跑全量测试，第二步构建产物，第三步部署并按步骤尽量核对结果。\n验收标准：测试全绿、部署后接口返回 200。"
    },
    {
      tpl: "agentcmd",
      title: "命令验收 · 合规",
      text: "角色：你是发布工程师，负责把 0.2.0 发到测试环境。\n背景：上一版发布漏了迁移脚本，回滚过一次。\n步骤：第一步跑全量测试，第二步构建产物，第三步部署到测试集群。\n约束与边界：只允许改动 config 目录，禁止直接操作生产库，单次发布不超过 30 分钟。\n验收标准：测试全绿、部署后接口返回 200、回滚脚本可用。"
    },
    {
      tpl: "agentcmd",
      title: "命令验收 · 缺验收标准",
      text: "角色：你是数据标注助手，负责整理本周的试点记录。\n背景：上一批记录字段不齐，返工过一次。\n步骤：第一步读入记录，第二步补齐缺失字段，第三步导出到共享目录。\n约束与边界：只允许改动 record 目录，禁止修改原始文件。"
    }
  ];;

  var SEV_ORDER = { high: 0, mid: 1, low: 2 };
  var SEV_LABEL = { high: "高优先", mid: "中优先", low: "低优先" };

  // yyb-2：空文本判 high（原实现会给出"可以交付"，与"没有正文"的直觉冲突）
  // yyb-3：新增第 5 套模板 agentcmd（Agent 命令验收，五区块）——只加模板，不改既有 4 套的判定
  // yyb-4：agentcmd 长度上限 1200 → 20000（与输入硬上限一致）；示例每套补到 3 条（共 15 条）
  var RULE_VERSION = "yyb-4";

  /* ---------------- 3. 工具（无副作用） ---------------- */

  function countChars(text) {
    // 字数按「非空白字符」计，与页面上的模板表口径一致
    return String(text).replace(/\s/g, "").length;
  }

  // 第 n 个「非空白字符」出现在原文的哪个下标——长度超限时用它定位起点
  function indexAtCharCount(text, n) {
    var seen = 0;
    for (var i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) continue;
      seen++;
      if (seen > n) return i;
    }
    return text.length;
  }

  function findAll(text, word) {
    var out = [];
    var from = 0;
    var at;
    while ((at = text.indexOf(word, from)) !== -1) {
      out.push(at);
      from = at + word.length;
    }
    return out;
  }

  /* ---------------- 4. 六类检查 ---------------- */

  function check(text, tpl) {
    text = String(text == null ? "" : text);
    var defects = [];
    var passes = [];
    var i, at;

    // 4.1 长度
    var chars = countChars(text);
    if (chars === 0) {
      // 空文本：只有一条 high，不再跑其余检查（yyb-2 起）
      defects.push({
        type: "格式", sev: "high",
        label: "全文为空",
        explain: "没有可校验的正文。请先把要交付的文本粘进来，再选模板重查。",
        start: -1, end: -1
      });
      return { defects: defects, passes: passes, chars: 0, requiredHit: 0 };
    }
    if (chars > tpl.maxChars) {
      defects.push({
        type: "长度", sev: "mid",
        label: "超出 " + (chars - tpl.maxChars) + " 字",
        explain: "模板上限 " + tpl.maxChars + " 字，现在是 " + chars + " 字。超出部分通常没人读完，建议压缩到上限内。",
        start: indexAtCharCount(text, tpl.maxChars), end: text.length
      });
    } else {
      passes.push("长度 " + chars + "/" + tpl.maxChars);
    }

    // 4.2 要素覆盖（缺了就没有可标的片段，只在清单里说缺哪一项）
    var hitRequired = 0;
    for (i = 0; i < tpl.required.length; i++) {
      if (tpl.required[i].re.test(text)) {
        hitRequired++;
        passes.push("要素·" + tpl.required[i].name);
      } else {
        defects.push({
          type: "要素覆盖", sev: "high",
          label: "缺「" + tpl.required[i].name + "」",
          explain: "全文没有找到表示「" + tpl.required[i].name + "」的内容。这一项没有可标注的原句，请自己补一段，不要用别的段落顶替。",
          start: -1, end: -1
        });
      }
    }

    // 4.3 禁用项（套话 / 无信息量表述）
    var bannedHits = 0;
    for (i = 0; i < tpl.banned.length; i++) {
      var word = tpl.banned[i];
      var spots = findAll(text, word);
      for (var k = 0; k < spots.length; k++) {
        bannedHits++;
        defects.push({
          type: "禁用项", sev: "mid",
          label: "套话「" + word + "」",
          explain: "换成具体做了什么、得到什么结果。套话在这里只占字数，不传递信息。",
          start: spots[k], end: spots[k] + word.length
        });
      }
    }
    if (!bannedHits) passes.push("套话 0 处");

    // 4.4 语气：感叹号数量 + 绝对化表述
    var bangs = findAll(text, "！").concat(findAll(text, "!"));
    bangs.sort(function (a, b) { return a - b; });
    if (bangs.length > tpl.maxExclaim) {
      at = bangs[tpl.maxExclaim];
      defects.push({
        type: "语气", sev: "low",
        label: "感叹号 " + bangs.length + " 个",
        explain: "这套模板最多允许 " + tpl.maxExclaim + " 个。交付文本里，情绪强度通常不承担信息。",
        start: at, end: at + 1
      });
    } else {
      passes.push("感叹号 " + bangs.length + "/" + tpl.maxExclaim);
    }

    var ABS_RE = /(一定能|绝对|必然|百分之百|完全可以|彻底解决|前所未有的)/g;
    var absolutes = text.match(ABS_RE);
    if (absolutes) {
      at = text.search(ABS_RE);
      defects.push({
        type: "语气", sev: "mid",
        label: "绝对化表述 " + absolutes.length + " 处",
        explain: "绝对化说法在评审和验收时最容易被追问「凭什么」。改成有条件的表述，或者补上证据。",
        start: at, end: at + absolutes[0].length
      });
    }

    // 4.5 格式：段落数
    var paras = text.split(/\n+/).filter(function (p) { return p.trim().length > 0; });
    if (paras.length < tpl.minParas) {
      defects.push({
        type: "格式", sev: "low",
        label: "只有 " + paras.length + " 段",
        explain: "这套模板至少要 " + tpl.minParas + " 段。整块文字读起来找不到结构，读者很难定位信息。",
        start: -1, end: -1
      });
    } else {
      passes.push("段落 " + paras.length);
    }

    // 4.6 事实一致性（只做「有量化断言就提醒」，不下真假结论）
    var QUANT_RE = /(\d+(?:\.\d+)?\s*%|提升\s*\d|增长\s*\d|降低\s*\d|提高了?\s*\d)/;
    var quant = text.match(new RegExp(QUANT_RE.source, "g"));
    if (quant) {
      at = text.search(QUANT_RE);
      defects.push({
        type: "事实一致性", sev: "mid",
        label: "量化断言 " + quant.length + " 处",
        explain: "出现具体数字（如「" + quant[0].trim() + "」）但没有出处。交付前补一句口径：谁测的、样本多少、什么条件下。",
        start: at, end: at + quant[0].length
      });
    } else {
      passes.push("无量化断言");
    }

    defects.sort(function (a, b) { return SEV_ORDER[a.sev] - SEV_ORDER[b.sev]; });

    return { defects: defects, passes: passes, chars: chars, requiredHit: hitRequired };
  }

  /* ---------------- 5. 结论 ---------------- */

  function verdictOf(defects) {
    var high = 0, mid = 0, low = 0;
    (defects || []).forEach(function (d) {
      if (d.sev === "high") high++;
      else if (d.sev === "mid") mid++;
      else low++;
    });
    if (high > 0) {
      return { cls: "is-bad", text: "不建议直接交付", why: "有 " + high + " 处需要先补内容，补完再交。", high: high, mid: mid, low: low };
    }
    if (mid > 0) {
      return { cls: "is-warn", text: "建议改一遍再交", why: "没有缺项，但有 " + mid + " 处说法或长度值得修。", high: 0, mid: mid, low: low };
    }
    return { cls: "is-ok", text: "可以交付", why: "这套模板的检查项都过了。事实出处仍需你自己确认。", high: 0, mid: 0, low: low };
  }

  /* ---------------- 6. 定位区间（交给外壳上色） ---------------- */

  function ranges(text, defects) {
    text = String(text == null ? "" : text);
    return (defects || [])
      .filter(function (d) { return d.start >= 0 && d.end > d.start; })
      .slice()
      .sort(function (a, b) { return a.start - b.start; })
      .reduce(function (out, d) {
        var last = out[out.length - 1];
        // 区间重叠时保留前一个，避免外壳画出嵌套高亮
        if (last && d.start < last.end) return out;
        out.push({ start: d.start, end: d.end, sev: d.sev, type: d.type, label: d.label });
        return out;
      }, []);
  }

  /* ---------------- 7. 一次调用拿全 ---------------- */

  function format(text, tpl) {
    var result = check(text, tpl);
    return {
      verdict: verdictOf(result.defects),
      chars: result.chars,
      defects: result.defects,
      passes: result.passes,
      requiredHit: result.requiredHit,
      ranges: ranges(text, result.defects)
    };
  }

  return {
    RULE_VERSION: RULE_VERSION,
    TEMPLATES: TEMPLATES,
    SAMPLES: SAMPLES,
    SEV_LABEL: SEV_LABEL,
    countChars: countChars,
    check: check,
    verdictOf: verdictOf,
    ranges: ranges,
    format: format
  };
});
