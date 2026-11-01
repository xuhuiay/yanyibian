/* ============================================================
   验一遍 YanYiBian —— 校验逻辑
   ============================================================

   这里没有任何网络请求：规则就是几个正则 + 几条计数，全部在
   浏览器里跑完。之所以这么做，一是因为部署成本为零（静态页即可），
   二是因为「说得清是哪一条不满足」比「模型觉得不太好」更有用——
   交付前自检要的是可复现的判断，不是又一次生成。

   结构：
     1. TEMPLATES  四套约束模板（每套＝长度 / 要素 / 禁用项 / 语气 / 格式）
     2. SAMPLES    内置示例文本，用来一键试跑
     3. check()    纯函数：文本 + 模板 → {缺陷列表, 通过项}
     4. render()   把结果画成「结论 + 指标 + 标注原文 + 缺陷清单」
   ============================================================ */

(function () {
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
    }
  };

  /* ---------------- 2. 内置示例 ---------------- */

  var SAMPLES = [
    {
      tpl: "weekly",
      title: "周报 · 缺风险段",
      text: "本周完成了数据采集脚本的重构，采集速度提升 40%，整体流程更加顺畅。\n下周计划把三条试点记录补齐，并同步更新标注规范。\n整个方案全面赋能后续实验，效率显著提升！"
    },
    {
      tpl: "notice",
      title: "通知 · 缺地点",
      text: "请全体成员于 11 月 9 日 24:00 前，把 30 条试点记录提交到共享表格，提交时务必核对字段是否齐全，缺项会被退回重填。"
    },
    {
      tpl: "general",
      title: "通用 · 套话与超长",
      text: "本项目致力于打造一体化解决方案，通过闭环设计全面赋能团队协作，是本领域唯一选择。\n我们相信这套抓手能够彻底解决沟通成本问题，让每个人都能百分之百专注在真正重要的事情上，从而在整体效率上取得前所未有的突破！！！"
    }
  ];

  var SEV_ORDER = { high: 0, mid: 1, low: 2 };
  var SEV_LABEL = { high: "高优先", mid: "中优先", low: "低优先" };

  /* ---------------- DOM ---------------- */

  var view = {
    templateList: document.getElementById("template-list"),
    templateSelect: document.getElementById("template-select"),
    templateDesc: document.getElementById("template-desc"),
    sampleList: document.getElementById("sample-list"),
    exampleSamples: document.getElementById("example-samples"),
    input: document.getElementById("text-input"),
    form: document.getElementById("check-form"),
    charCount: document.getElementById("char-count"),
    result: document.getElementById("result-area"),
    toast: document.getElementById("toast"),
    clearSample: document.getElementById("clear-sample")
  };

  var state = { tpl: "weekly" };

  /* ---------------- 工具函数 ---------------- */

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function countChars(text) {
    return text.replace(/\s/g, "").length;
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

  function toast(msg) {
    view.toast.textContent = msg;
    view.toast.classList.add("is-visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { view.toast.classList.remove("is-visible"); }, 2200);
  }

  /* ---------------- 3. 校验 ---------------- */

  function check(text, tpl) {
    var defects = [];
    var passes = [];
    var i, at;

    // 3.1 长度
    var chars = countChars(text);
    if (chars > tpl.maxChars) {
      defects.push({
        type: "长度", sev: "mid",
        label: "超出 " + (chars - tpl.maxChars) + " 字",
        explain: "模板上限 " + tpl.maxChars + " 字，现在是 " + chars + " 字。超出部分通常没人读完，建议压缩到上限内。",
        start: indexAtCharCount(text, tpl.maxChars), end: text.length, mark: "hl"
      });
    } else {
      passes.push("长度 " + chars + "/" + tpl.maxChars);
    }

    // 3.2 要素覆盖（缺了就没有可标的片段，只在清单里说缺哪一项）
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
          start: -1, end: -1, mark: ""
        });
      }
    }

    // 3.3 禁用项（套话 / 无信息量表述）
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
          start: spots[k], end: spots[k] + word.length, mark: "hl"
        });
      }
    }
    if (!bannedHits) passes.push("套话 0 处");

    // 3.4 语气：感叹号数量 + 绝对化表述
    var bangs = findAll(text, "！").concat(findAll(text, "!"));
    bangs.sort(function (a, b) { return a - b; });
    if (bangs.length > tpl.maxExclaim) {
      at = bangs[tpl.maxExclaim];
      defects.push({
        type: "语气", sev: "low",
        label: "感叹号 " + bangs.length + " 个",
        explain: "这套模板最多允许 " + tpl.maxExclaim + " 个。交付文本里，情绪强度通常不承担信息。",
        start: at, end: at + 1, mark: "hl"
      });
    } else {
      passes.push("感叹号 " + bangs.length + "/" + tpl.maxExclaim);
    }

    var absolutes = text.match(/(一定能|绝对|必然|百分之百|完全可以|彻底解决|前所未有的)/g);
    if (absolutes) {
      at = text.search(/(一定能|绝对|必然|百分之百|完全可以|彻底解决|前所未有的)/);
      defects.push({
        type: "语气", sev: "mid",
        label: "绝对化表述 " + absolutes.length + " 处",
        explain: "绝对化说法在评审和验收时最容易被追问「凭什么」。改成有条件的表述，或者补上证据。",
        start: at, end: at + absolutes[0].length, mark: "hl"
      });
    }

    // 3.5 格式：段落数
    var paras = text.split(/\n+/).filter(function (p) { return p.trim().length > 0; });
    if (paras.length < tpl.minParas) {
      defects.push({
        type: "格式", sev: "low",
        label: "只有 " + paras.length + " 段",
        explain: "这套模板至少要 " + tpl.minParas + " 段。整块文字读起来找不到结构，读者很难定位信息。",
        start: -1, end: -1, mark: ""
      });
    } else {
      passes.push("段落 " + paras.length);
    }

    // 3.6 事实一致性（本地只做「有量化断言就提醒」，不下结论）
    var quant = text.match(/(\d+(?:\.\d+)?\s*%|提升\s*\d|增长\s*\d|降低\s*\d|提高了?\s*\d)/g);
    if (quant) {
      at = text.search(/(\d+(?:\.\d+)?\s*%|提升\s*\d|增长\s*\d|降低\s*\d|提高了?\s*\d)/);
      defects.push({
        type: "事实一致性", sev: "mid",
        label: "量化断言 " + quant.length + " 处",
        explain: "出现具体数字（如「" + quant[0].trim() + "」）但没有出处。交付前补一句口径：谁测的、样本多少、什么条件下。",
        start: at, end: at + quant[0].length, mark: "hl is-warn"
      });
    } else {
      passes.push("无量化断言");
    }

    defects.sort(function (a, b) { return SEV_ORDER[a.sev] - SEV_ORDER[b.sev]; });

    return { defects: defects, passes: passes, chars: chars, requiredHit: hitRequired };
  }

  /* ---------------- 4. 渲染 ---------------- */

  function highlight(text, defects) {
    var spans = defects.filter(function (d) { return d.start >= 0 && d.end > d.start; })
      .sort(function (a, b) { return a.start - b.start; });
    var html = "";
    var cursor = 0;
    for (var i = 0; i < spans.length; i++) {
      var d = spans[i];
      if (d.start < cursor) continue;
      html += esc(text.slice(cursor, d.start));
      html += '<mark class="' + d.mark + '">' + esc(text.slice(d.start, d.end)) + "</mark>";
      cursor = d.end;
    }
    html += esc(text.slice(cursor));
    return html;
  }

  function verdictOf(defects) {
    var high = 0, mid = 0, low = 0;
    defects.forEach(function (d) {
      if (d.sev === "high") high++;
      else if (d.sev === "mid") mid++;
      else low++;
    });
    if (high > 0) return { cls: "is-bad", text: "不建议直接交付", why: "有 " + high + " 处需要先补内容，补完再交。", high: high, mid: mid, low: low };
    if (mid > 0) return { cls: "is-warn", text: "建议改一遍再交", why: "没有缺项，但有 " + mid + " 处说法或长度值得修。", high: 0, mid: mid, low: low };
    return { cls: "is-ok", text: "可以交付", why: "这套模板的检查项都过了。事实出处仍需你自己确认。", high: 0, mid: 0, low: low };
  }

  function render(text, tpl, result) {
    var v = verdictOf(result.defects);
    var now = new Date();
    var clock = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
    var html = "";

    html += '<div class="result-heading"><div><h3>结论：' + v.text + "</h3><p>" + esc(v.why) + "</p></div>";
    html += '<span class="result-tag">' + clock + " · " + esc(tpl.label) + "</span></div>";

    html += '<div class="metric-grid">';
    html += '<div class="metric-card"><small>字数 / 上限</small><strong>' + result.chars + "</strong><span>上限 " + tpl.maxChars + "</span></div>";
    html += '<div class="metric-card"><small>缺陷</small><strong>' + result.defects.length + "</strong><span>" + v.high + " 处高优先</span></div>";
    html += '<div class="metric-card"><small>通过项</small><strong>' + result.passes.length + "</strong><span>" + (result.defects.length ? "其余正常" : "全部通过") + "</span></div>";
    html += "</div>";

    html += '<div class="analysis-grid">';
    html += '<div class="result-panel"><h4>原文 · 标出的就是有问题的地方</h4>';
    html += '<div class="text-body">' + highlight(text, result.defects) + "</div>";
    var unlocated = result.defects.filter(function (d) { return d.start < 0; }).length;
    if (unlocated) {
      html += '<p class="empty-note">有 ' + unlocated + " 处缺陷没有可标注的片段（要素缺失这一类），位置只能写在右侧清单里。\u003c/p>";
    }
    html += "</div>";

    html += '<div class="result-panel"><h4>缺陷清单 · 按优先度排</h4>';
    if (result.defects.length) {
      html += '<ul class="defect-list">';
      for (var i = 0; i < result.defects.length; i++) {
        var d = result.defects[i];
        html += '<li class="defect-item"><span class="defect-dot sev-' + d.sev + '"></span><div class="defect-main">';
        html += "<b>" + esc(d.label) + "</b>";
        html += "<p>" + esc(d.explain) + "</p>";
        html += '<div class="defect-meta"><span>' + esc(d.type) + "</span><span>" + SEV_LABEL[d.sev] + "</span><span>" + (d.start >= 0 ? "位置 " + d.start + "–" + d.end : "无片段") + "</span></div>";
        html += "</div></li>";
      }
      html += "</ul>";
    } else {
      html += '<p class="empty-note">没有发现问题。这里的检查只覆盖模板写死的规则，事实真假和是否合适仍要人来判断。</p>';
    }
    if (result.passes.length) {
      html += '<div class="pass-list">';
      for (var j = 0; j < result.passes.length; j++) {
        html += '<span class="pass-chip">' + esc(result.passes[j]) + "</span>";
      }
      html += "</div>";
    }
    html += "</div></div>";

    html += '<div class="repo-cta"><div><p><b>验一遍</b> 的源码与规则都放在 GitHub 上，规则可以直接改。</p>';
    html += '<small>静态页面 · 无后端 · 无数据库 · 不发起任何请求</small></div>';
    html += '<a class="repo-link" href="https://github.com/xuhuiay/验一遍" target="_blank" rel="noopener noreferrer">';
    html += '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
    html += "在 GitHub 打开";
    html += "</a></div>";

    view.result.innerHTML = html;
  }

  /* ---------------- 模板 / 示例的交互 ---------------- */

  function renderTemplates() {
    var keys = Object.keys(TEMPLATES);
    var listHtml = "";
    var selectHtml = "";
    keys.forEach(function (key) {
      var t = TEMPLATES[key];
      var active = key === state.tpl ? " is-active" : "";
      listHtml += '<button class="dataset-item' + active + '" type="button" data-tpl="' + key + '">';
      listHtml += '<span class="dataset-symbol">' + (key === "weekly" ? "▤" : key === "notice" ? "◫" : key === "readme" ? "◈" : "▦") + "</span>";
      listHtml += "<span><b>" + esc(t.label) + "</b><small>" + esc(t.short) + "</small></span></button>";
      selectHtml += '<option value="' + key + '"' + (key === state.tpl ? " selected" : "") + ">" + esc(t.label) + "</option>";
    });
    view.templateList.innerHTML = listHtml;
    view.templateSelect.innerHTML = selectHtml;
    view.templateDesc.textContent = TEMPLATES[state.tpl].desc;
  }

  function renderSamples() {
    var listHtml = "";
    var chipHtml = "";
    SAMPLES.forEach(function (s, i) {
      listHtml += '<button class="history-item" type="button" data-sample="' + i + '">';
      listHtml += "<b>" + esc(s.title) + "</b><small>" + esc(TEMPLATES[s.tpl].label) + "</small></button>";
      chipHtml += '<button type="button" data-sample="' + i + '">' + esc(s.title) + "</button>";
    });
    view.sampleList.innerHTML = listHtml;
    view.exampleSamples.innerHTML = chipHtml;
  }

  function useSample(index) {
    var s = SAMPLES[index];
    if (!s) return;
    state.tpl = s.tpl;
    renderTemplates();
    view.input.value = s.text;
    view.charCount.textContent = countChars(s.text) + " 字 · 本地校验 · 不上传";
    run();
  }

  function run() {
    var text = view.input.value;
    if (!text.trim()) {
      toast("先贴一段文字");
      return;
    }
    var tpl = TEMPLATES[state.tpl];
    render(text, tpl, check(text, tpl));
  }

  function bind() {
    view.templateList.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-tpl]");
      if (!btn) return;
      state.tpl = btn.getAttribute("data-tpl");
      renderTemplates();
      if (view.input.value.trim()) run();
    });

    view.templateSelect.addEventListener("change", function (e) {
      state.tpl = e.target.value;
      renderTemplates();
      if (view.input.value.trim()) run();
    });

    [view.sampleList, view.exampleSamples].forEach(function (node) {
      node.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-sample]");
        if (!btn) return;
        useSample(Number(btn.getAttribute("data-sample")));
      });
    });

    view.form.addEventListener("submit", function (e) {
      e.preventDefault();
      run();
    });

    view.input.addEventListener("input", function () {
      view.charCount.textContent = countChars(view.input.value) + " 字 · 本地校验 · 不上传";
    });

    view.clearSample.addEventListener("click", function () {
      view.input.value = "";
      view.charCount.textContent = "0 字 · 本地校验 · 不上传";
      view.result.innerHTML = '<div class="result-empty"><div class="empty-orbit">⌁</div><h3>贴一段文字，看看它缺了什么</h3><p>不需要懂规则：选模板、贴文本、点校验，缺陷会标在原文上。</p></div>';
    });
  }

  renderTemplates();
  renderSamples();
  bind();
})();