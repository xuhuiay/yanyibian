(() => {
  "use strict";

  const STORAGE_KEY = "datawave-workspace-v1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = selector => document.querySelector(selector);
  const datasets = {
    content: {
      name: "内容实验记录",
      description: "我最近做过的内容实验和它们带来的结果。",
      questions: {
        continue: {
          title: "最值得继续的是轻量工具实验",
          subtitle: "按完成率与复用次数综合判断",
          metrics: [["实验次数", "24", "较上期 +8"], ["平均完成率", "68%", "较上期 +12%"], ["复用次数", "47", "较上期 +19%"]],
          bars: [["对话", 48], ["工具", 82], ["流程", 64], ["数据", 56], ["写作", 71]],
          insight: "从记录看，越接近一个真实动作的实验，越容易被我重复使用。工具实验的复用次数最高，说明“做出一个可点击的最小版本”比继续补充概念更有效。",
          points: ["工具实验的完成率最高，平均达到 82%。", "复用次数和完成率一起上升，说明结果开始进入日常。", "下一步适合把高频动作整理成一个稳定的小流程。"]
        },
        output: {
          title: "投入增加后，产出先上升再趋于平稳",
          subtitle: "按每周投入时长与可复用产出对照",
          metrics: [["记录周数", "26", "覆盖近 6 个月"], ["平均投入", "4.6h", "每周"], ["可复用产出", "18", "小工具与模板"]],
          bars: [["1月", 42], ["2月", 58], ["3月", 73], ["4月", 79], ["5月", 76]],
          insight: "前几周的投入主要用于摸索，到了第三个月以后，产出增长开始放慢。比起单纯增加时间，更值得做的是把已经验证过的步骤固化下来。",
          points: ["第三个月是投入产出比明显变好的阶段。", "后期产出趋于稳定，说明流程化还有空间。", "适合每月留一周做整理，而不是持续堆新实验。"]
        },
        repeat: {
          title: "能形成连续记录的主题是 AI 应用与生活观察",
          subtitle: "按主题出现频率与连续记录天数统计",
          metrics: [["主题数量", "6", "当前分类"], ["连续记录", "11 天", "最长一段"], ["高频主题", "2 个", "AI 应用、生活观察"]],
          bars: [["AI", 88], ["工具", 70], ["方法", 61], ["写作", 52], ["生活", 76]],
          insight: "持续记录不完全取决于主题是否专业，而取决于它有没有和日常经验连接起来。AI 应用提供问题，生活观察提供材料，两者交替时最容易写下去。",
          points: ["AI 应用是出现频率最高的主题。", "生活观察虽然轻，但更容易形成连续记录。", "可以尝试让每次技术实验都留下一个生活侧的观察。"]
        }
      }
    },
    reading: {
      name: "阅读与学习",
      description: "今年读过的书、文章和留下来的问题。",
      questions: {
        continue: {
          title: "最值得继续的是应用型学习",
          subtitle: "按读完率与实践次数综合判断",
          metrics: [["学习条目", "18", "本年度"], ["读完率", "72%", "较上期 +9%"], ["实践次数", "31", "笔记中出现"]],
          bars: [["AI", 84], ["设计", 61], ["写作", 76], ["商业", 48], ["心理", 58]],
          insight: "能够马上转化成一个动作的内容，更容易留下来。读完不是终点，真正能改变工作方式的，往往是读完后做出的那一次小尝试。",
          points: ["AI 与写作主题的实践次数最高。", "纯理论内容的读完率较低，适合搭配具体问题阅读。", "下一步可以为每次阅读设置一个最小实践动作。"]
        },
        output: {
          title: "稳定的阅读节奏比集中突击更有效",
          subtitle: "按每月阅读数量与笔记回看次数对照",
          metrics: [["阅读月份", "9", "今年已有记录"], ["月均条目", "2.0", "篇 / 本"], ["回看次数", "43", "次笔记回看"]],
          bars: [["1月", 38], ["2月", 51], ["3月", 67], ["4月", 56], ["5月", 74]],
          insight: "阅读量最多的月份并不一定带来最多收获。回看次数更能说明内容是否真正进入了自己的思考系统，稳定、适度的节奏更有利于积累。",
          points: ["五月的回看次数最高。", "集中阅读后需要留出整理时间。", "适合保持每周一次的轻量回顾。"]
        }
      }
    }
  };
  let state = loadState();
  let busy = false;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return { dataset: saved?.dataset || "content", history: Array.isArray(saved?.history) ? saved.history : [] };
    } catch (error) { return { dataset: "content", history: [] }; }
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("is-visible"); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400); }
  function nowLabel() { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date()); }
  function renderDatasets() {
    $("#dataset-select").value = state.dataset;
    document.querySelectorAll("[data-dataset]").forEach(button => button.classList.toggle("is-active", button.dataset.dataset === state.dataset));
    const dataset = datasets[state.dataset];
    $("#dataset-state").textContent = dataset.name;
    $("#dataset-description").textContent = dataset.description;
  }
  function renderHistory() {
    const list = $("#question-history");
    if (!state.history.length) { list.innerHTML = '<div class="history-empty">还没有提问记录。<br>从上面的示例开始。</div>'; return; }
    list.innerHTML = state.history.slice().reverse().map(item => `<button class="history-item" type="button" data-history-query="${item.query}"><b>${item.query}</b><small>${item.date}</small></button>`).join("");
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }
  function resolveQuestion(query) {
    if (/投入|产出|时间|关系|时长|效率|收益/.test(query)) return "output";
    if (/主题|持续|记录|坚持|习惯|连续/.test(query)) return "repeat";
    if (/继续|值得|实验|工具|优先|方向|下一步/.test(query)) return "continue";
    return null;
  }
  function renderResult(result, query) {
    const max = Math.max(...result.bars.map(item => item[1]));
    $("#result-area").innerHTML = `
      <div class="result-heading"><div><p class="eyebrow">ANALYSIS RESULT</p><h3>${result.title}</h3><p>${result.subtitle}</p></div><span class="result-tag">LOCAL DEMO</span></div>
      <div class="metric-grid">${result.metrics.map(metric => `<div class="metric-card"><small>${metric[0]}</small><strong>${metric[1]}</strong><span>${metric[2]}</span></div>`).join("")}</div>
      <div class="analysis-grid">
        <section class="result-panel"><h4>主题表现</h4><div class="bar-chart">${result.bars.map(item => `<div class="bar-column"><span class="bar-value">${item[1]}</span><div class="bar" style="height:${Math.max(12, item[1] / max * 145)}px"></div><span class="bar-label">${item[0]}</span></div>`).join("")}</div></section>
        <section class="result-panel insight-copy"><div><h4>澜图的解释</h4><p>${result.insight}</p></div><div class="insight-points">${result.points.map(point => `<div><i></i><span>${point}</span></div>`).join("")}</div></section>
      </div>
      <p class="result-footnote">基于“${escapeHtml(query)}”生成的本地演示结果 · 数据仅用于展示交互方式</p>`;
  }
  function renderOutOfScope(query, dataset) {
    const samples = ["最近哪类实验最值得继续？", "过去六个月，我的投入和产出是什么关系？", "哪些主题最容易形成持续记录？"];
    $("#result-area").innerHTML = `
      <div class="result-heading"><div><p class="eyebrow">OUT OF SCOPE</p><h3>这个问题不在演示数据的范围内</h3><p>澜图目前只有「${escapeHtml(dataset.name)}」这一份写死的示例数据，只能回答和它相关的问题。</p></div><span class="result-tag">LOCAL DEMO</span></div>
      <div class="result-panel" style="margin-top:22px"><h4>可以试试这几个问题</h4><div class="insight-points">${samples.map(item => `<div><i></i><span>${item}</span></div>`).join("")}</div></div>
      <p class="result-footnote">你问的是「${escapeHtml(query)}」· 本页不联网、不调用模型，所有结果都是本地演示</p>`;
  }
  async function ask(query) {
    const cleanQuery = query.trim();
    if (!cleanQuery || busy) return;
    busy = true;
    $("#ask-button")?.setAttribute("disabled", "disabled");
    $("#result-area").innerHTML = '<div class="result-loading"><span class="loading-line"></span><span class="loading-line"></span><span class="loading-line"></span><span class="loading-label">正在整理你的问题...</span></div>';
    await new Promise(resolve => window.setTimeout(resolve, reducedMotion ? 80 : 620));
    const dataset = datasets[state.dataset];
    const key = resolveQuestion(cleanQuery);
    if (key && dataset.questions[key]) renderResult(dataset.questions[key], cleanQuery);
    else renderOutOfScope(cleanQuery, dataset);
    state.history.push({ query: cleanQuery, date: nowLabel() });
    state.history = state.history.slice(-12);
    saveState();
    renderHistory();
    busy = false;
    $("#ask-button")?.removeAttribute("disabled");
  }
  function clearHistory() { state.history = []; saveState(); renderHistory(); showToast("提问历史已清空"); }

  $("#query-form").addEventListener("submit", event => { event.preventDefault(); const input = $("#query-input"); const query = input.value; input.value = ""; ask(query); });
  $("#query-input").addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#query-form").requestSubmit(); } });
  $("#example-questions").addEventListener("click", event => { const button = event.target.closest("[data-query]"); if (!button) return; $("#query-input").value = button.dataset.query; $("#query-input").focus(); });
  $("#dataset-list").addEventListener("click", event => { const button = event.target.closest("[data-dataset]"); if (!button || busy) return; state.dataset = button.dataset.dataset; saveState(); renderDatasets(); showToast(`已切换到${datasets[state.dataset].name}`); });
  $("#dataset-select").addEventListener("change", event => { if (busy) return; state.dataset = event.target.value; saveState(); renderDatasets(); showToast(`已切换到${datasets[state.dataset].name}`); });
  $("#question-history").addEventListener("click", event => { const button = event.target.closest("[data-history-query]"); if (!button) return; $("#query-input").value = button.dataset.historyQuery; $("#query-input").focus(); });
  $("#clear-history").addEventListener("click", clearHistory);
  $("#clear-history-side").addEventListener("click", clearHistory);
  renderDatasets();
  renderHistory();
})();
