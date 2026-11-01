(() => {
  "use strict";

  const STORAGE_KEY = "sheentalk-workspace-v1";
  const SETTINGS_KEY = "sheentalk-settings-v1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = selector => document.querySelector(selector);
  const uid = () => `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const nowLabel = timestamp => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(timestamp));
  const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  /* 滚动只作用于聊天栏内部，页面整体保持固定 */
  function scrollToLatest() {
    const conversation = $("#conversation");
    if (!conversation) return;
    conversation.scrollTo({ top: conversation.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }

  /* ==========================================================================
     L2 · 公开接口层
     只使用「无需密钥 + 支持跨域 + HTTPS」的接口。
     任何失败（超时 / 结构变化 / 断网 / 被限流）都返回 null，静默交给下一层。
     ========================================================================== */

  const WMO_TEXT = {
    0: "晴", 1: "大致晴朗", 2: "局部多云", 3: "阴",
    45: "有雾", 48: "有雾凇",
    51: "毛毛雨", 53: "小雨", 55: "中雨", 56: "冻毛毛雨", 57: "冻雨",
    61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "阵雨", 81: "强阵雨", 82: "暴雨", 85: "阵雪", 86: "强阵雪",
    95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷暴"
  };

  const CITY_LIST = [
    "北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安", "南京", "重庆",
    "天津", "苏州", "长沙", "郑州", "青岛", "厦门", "宁波", "无锡", "合肥", "福州",
    "济南", "大连", "沈阳", "昆明", "哈尔滨", "南昌", "贵阳", "南宁", "太原", "石家庄",
    "兰州", "海口", "乌鲁木齐", "拉萨", "呼和浩特", "银川", "西宁"
  ];

  const INTENT_RULES = [
    { id: "weather", test: /天气|气温|下雨|下雪|雨伞|带伞|冷不冷|热不热|几度|温度/ },
    { id: "quote", test: /一言|来一句|说句话|念一句|名言|金句|随便说点/ }
  ];

  function classifyIntent(text) {
    const hit = INTENT_RULES.find(rule => rule.test.test(text));
    return hit ? hit.id : null;
  }

  function extractCity(text) {
    return CITY_LIST.find(city => text.includes(city)) || null;
  }

  async function getJSON(url, timeout = 4000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  function weatherAdvice(temp, code) {
    if (code >= 95) return "有雷雨，尽量避开户外活动。";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "外面在下雪，注意保暖和路滑。";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "出门记得带把伞。";
    if (code === 45 || code === 48) return "有雾，出行注意能见度。";
    if (typeof temp === "number" && temp <= 5) return "气温偏低，多穿一件。";
    if (typeof temp === "number" && temp >= 30) return "天气偏热，注意补水。";
    return "体感还算舒适。";
  }

  const PROVIDERS = {
    async weather(text) {
      const city = extractCity(text);
      if (!city) return "想查天气的话，告诉我城市名就行，比如「北京天气怎么样」。";
      const geo = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
      const place = geo?.results?.[0];
      if (!place) return null;
      const forecast = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`);
      const temp = forecast?.current?.temperature_2m;
      const code = forecast?.current?.weather_code;
      if (typeof temp !== "number") return null;
      return `${place.name}现在 ${Math.round(temp)}°C，${WMO_TEXT[code] || "天气状况未知"}。${weatherAdvice(temp, code)}`;
    },

    async quote() {
      const data = await getJSON("https://v1.hitokoto.cn/");
      const sentence = typeof data?.hitokoto === "string" ? data.hitokoto.trim() : "";
      if (!sentence) return null;
      const author = [data.from_who, data.from].filter(Boolean).join(" · ");
      return author ? `「${sentence}」\n\n—— ${author}` : `「${sentence}」`;
    }
  };

  /* ==========================================================================
     L1 · 本地知识库层
     纯前端检索，零网络请求、零数据传输。
     新增内容只需往下面的数组里加对象；tags 越具体，命中越准。
     注意：以下 6 条均为占位内容，请替换成你自己的真实笔记要点。
     ========================================================================== */

  const KNOWLEDGE = [
    {
      title: "这个站是什么",
      tags: ["这个站", "网站", "汐星札记", "sheenova", "介绍", "做什么的", "谁的站", "谁做的"],
      body: "汐星札记是我个人的 AI 学习记录站。这里放的是我自己在折腾 AI 过程中的观察、笔记和做过的小实验。\n\n它不是教程站，也不提供任何服务或商品——就是一个公开的笔记本。",
      link: "index.html#capabilities"
    },
    {
      title: "汐言是什么",
      tags: ["汐言", "sheentalk", "这个对话", "聊天框", "对话实验", "这个页面"],
      body: "汐言是我做的一个对话实验，也是这个站上的说话入口。\n\n它不用任何配置就能用：问站上的事，它会查我写在代码里的知识库；问天气这类实时信息，它会去调公开接口；如果你愿意填一个自己的模型密钥，它还能聊得更开。\n\n我给它定的第一目标不是答得准，而是不管问什么都能回你点什么——三层一层层往下接，最后还有兜底，不会让你对着一个空白页面发呆。",
      link: "sheentalk.html"
    },
    {
      title: "我最近在关注什么方向",
      tags: ["方向", "关注", "研究", "最近", "在做什么", "忙什么", "兴趣"],
      body: "目前主要在看「AI 应用怎么真正被用起来」这件事：什么样的场景值得用模型、什么样的不值得。\n\n我自己更感兴趣的是把模型接到具体的小工具里，而不是研究模型本身。",
      link: "index.html#capabilities"
    },
    {
      title: "我是怎么开始学 AI 的",
      tags: ["学习", "入门", "新手", "零基础", "怎么学", "从哪开始", "学不会"],
      body: "我的路径大概是这样：先不急着读论文，而是找一个自己真的想解决的小问题，然后试着用现成的模型把它做出来。\n\n做出来的东西通常很粗糙，但过程中会自然遇到「为什么它不行」的问题，那时候再去补原理，效率高得多。",
      link: "index.html#method"
    },
    {
      title: "我平时是怎么折腾的",
      tags: ["方法", "做事流程", "怎么做", "习惯", "折腾", "工作方式"],
      body: "我一般分五步，从「洞察」开始：先找到真正值得琢磨的那个小问题，再把它拆成能验证的假设，然后做一个最小版本跑起来，接着让它真正被用起来，最后是记录和一遍遍改进。\n\n这五步里最容易跳过的是头和尾。跳过开头，会做完才发现解决的不是真问题；跳过结尾，下次遇到同一个坑还得重新踩一遍。",
      link: "index.html#method"
    },
    {
      title: "我做过的小实验",
      tags: ["实验", "项目", "做过什么", "小工具", "作品", "小东西"],
      body: "站里放了三个我自己玩的小东西：对话实验「汐言 SheenTalk」、流程编排的「星潮 AgentFlow」，还有处理数据的「澜图 DataWave」。\n\n它们都是纯前端的小样，主要用来验证想法，不追求实用性。",
      link: "index.html#products"
    },
    {
      title: "星潮是什么",
      tags: ["星潮", "agentflow", "流程", "工作流", "智能体", "编排", "节点", "画布"],
      body: "星潮是我做的一个流程编排练习：在画布上把「智能体、工具调用、条件分流、人工确认」这几种节点连起来，看看一个任务该怎么被拆成几步交接。\n\n它现在是纯本地模拟——点「运行流程」只会按顺序走一遍动画，不会真的调用任何模型。",
      link: "starflow.html"
    },
    {
      title: "澜图是什么",
      tags: ["澜图", "datawave", "数据", "分析", "图表", "数据集", "问数据", "柱状图"],
      body: "澜图是我尝试「用自然语言问数据」的一个实验。左边选一份数据，直接用大白话提问，它会把答案拆成指标、柱状图和一段解释。\n\n目前里面只有两份写死的示例数据（内容实验记录、阅读与学习），不联网也没接模型。问到范围之外的事情，它会直接说明，而不是硬凑一个答案。",
      link: "datawave.html"
    },
    {
      title: "这三个实验各有什么区别",
      tags: ["三个实验", "都能做什么", "有什么区别", "各自", "分别", "三个东西"],
      body: "三个实验各自解决一个不同的问题：\n\n汐言 SheenTalk —— 对话窗口，用来把想法说清楚；\n星潮 AgentFlow —— 流程编排，用来把一个目标拆成交接的步骤；\n澜图 DataWave —— 数据提问，用来从记录里看出规律。\n\n三个都是本地演示，没有一个会把你的输入发到外面去。",
      link: "index.html#products"
    },
    {
      title: "你能做什么",
      tags: ["能做什么", "功能", "会什么", "支持什么", "能力", "可以问什么", "能联网吗", "会查天气吗"],
      body: "目前能做的有这几件。\n\n站上的事基本都能答——这个站是干什么的、三个实验分别是什么、我在关注什么方向，答案来自我写在代码里的知识库。\n\n天气也能查。说一个城市名，它会去调公开的天气接口拿实时数据。\n\n还可以让它来一句一言，试试说「来句话」。\n\n如果你在设置里填了自己的模型接口，它就能像普通对话助手那样聊更广的话题。\n\n范围之外的东西，它会老实说不知道，而不是硬编一个。",
      link: "sheentalk.html"
    },
    {
      title: "我输入的内容会被保存吗",
      tags: ["隐私", "保存", "会被记录吗", "发到哪里", "数据安全", "安全吗", "会上传吗", "我的对话"],
      body: "对话只存在你自己的浏览器里（localStorage），不会上传到我的服务器。你在设置里填的密钥也一样，只留在本地，我这边看不到。\n\n有两处例外要说清楚。一是问天气时，城市名会被发到公开的天气接口；用一言时同理。二是如果你自己填了模型接口，你发的内容会直接到那家模型服务商那里——这没法避免，跟直接用他们的服务是一回事。\n\n除此之外，这个页面不会把任何东西发出去。",
      link: "sheentalk.html"
    },
    {
      title: "为什么要我自己填密钥",
      tags: ["密钥", "apikey", "api key", "key", "为什么要填", "怎么配置", "接模型", "自己的模型"],
      body: "因为密钥不能写在网页代码里。前端代码是公开的，任何人「查看源代码」都能看到里面写了什么，密钥放进去等于直接公开。\n\n所以汐言的做法是：模型接口由你自己填，密钥只存在你的浏览器里。我不需要替你保管密钥，你也不用担心从我这边泄露。\n\n代价是想用这一层得自己准备一个接口。不配也完全没问题，前面两层不需要密钥。",
      link: "sheentalk.html"
    },
    {
      title: "答不上来的时候怎么办",
      tags: ["答不上来", "不知道", "为什么不会", "回答不了", "答非所问", "不准", "出错", "听不懂"],
      body: "如果它答非所问，通常是两个原因。\n\n一是你问的东西不在这个站的范围内。它主要了解站上写了什么，别的话题知道得有限，这种时候它会直接说不知道。\n\n二是你的说法离知识库里的措辞太远，检索没匹配上。换个更直接的问法常常就好了，比如把「你这网站都搞了些什么名堂」换成「这个站是做什么的」。\n\n想聊知识库以外的话题，在设置里填一个自己的模型接口会好很多。",
      link: "sheentalk.html"
    },
    {
      title: "我都写了哪些笔记",
      tags: ["笔记", "文章", "写了什么", "博客", "最近写的", "有什么内容", "你的文章"],
      body: "目前写了三篇。\n\n《我为什么还在做这些小工具》聊的是，为什么做不出什么大东西，还在一个个地做。\n\n《从模型到应用，中间隔着什么》聊的是，把模型接口调通之后，真正要面对的是什么。\n\n《给未来的自己留一份使用说明》聊的是，为什么值得把踩过的坑记下来。\n\n首页「最近写下的」那一栏可以直接点开。",
      link: "index.html#insights"
    },
    {
      title: "这个站是怎么做出来的",
      tags: ["怎么做的", "什么做的", "怎么做出来的", "技术", "用的什么", "有没有后端", "服务器", "静态网站", "源码", "框架"],
      body: "整个站是纯静态的：手写的 HTML、CSS 和 JavaScript。没有框架，没有构建工具，也没有后端服务。\n\n这么做的直接好处是部署简单、打开快，而且不需要服务器上一直跑着什么程序。三个实验也都在浏览器里跑完，不依赖服务端。\n\n唯一算得上「服务」的，是一台 2 核 2G 的云服务器，用来放这些文件。",
      link: "index.html"
    },
    {
      title: "怎么联系我",
      tags: ["联系", "邮箱", "写信", "交流", "反馈", "合作", "找你"],
      body: "直接写邮件就行：huxleystars@foxmail.com。\n\n如果是发现文章里写错了，特别欢迎——这类反馈我都会认真看。",
      link: "index.html#contact"
    }
  ];

  const SMALL_TALK = /^(你好|您好|hi|hello|嗨|哈喽|在吗|在不在|有人吗|早|早上好|下午好|晚上好|谢谢|多谢|感谢|再见|拜拜|你是谁|你叫什么|你是什么|你是干什么的|你会什么|你能做什么|有什么功能|有什么用|能帮我做什么|介绍一下你|介绍一下你自己)[\s!！。~～?？、,，]*$/i;

  function normalize(text) {
    return String(text).toLowerCase().replace(/[\s，。！？、,.!?~～:：;；"'“”‘’()（）[\]【】]/g, "");
  }

  function bigrams(text) {
    const grams = new Set();
    if (text.length === 1) { grams.add(text); return grams; }
    for (let index = 0; index < text.length - 1; index++) grams.add(text.slice(index, index + 2));
    return grams;
  }

  function countOverlap(left, right) {
    let count = 0;
    left.forEach(gram => { if (right.has(gram)) count++; });
    return count;
  }

  function searchKnowledge(text) {
    const query = normalize(text);
    if (query.length < 2) return null;
    if (SMALL_TALK.test(query)) return null;
    const queryGrams = bigrams(query);
    let best = null;
    let bestScore = 0;
    KNOWLEDGE.forEach(entry => {
      const tagHits = entry.tags.filter(tag => query.includes(normalize(tag))).length;
      const titleOverlap = countOverlap(queryGrams, bigrams(normalize(entry.title)));
      const bodyOverlap = countOverlap(queryGrams, bigrams(normalize(entry.body)));
      const score = tagHits * 12 + titleOverlap * 3 + bodyOverlap;
      if (score > bestScore) { bestScore = score; best = entry; }
    });
    return bestScore >= 6 ? best : null;
  }

  /* ==========================================================================
     L0 · 本地应答层
     寒暄、站点元问题、本地可算的能力（时间 / 日期），以及最终兜底。
     这一层永远不返回空值，保证上面任何一层失败时都有人接住。
     ========================================================================== */

  const DEMO_RULES = [
    {
      cursor: 0,
      test: /^(你好|您好|hi|hello|嗨|哈喽|在吗|在不在|有人吗)[\s!！。~～?？]*$/i,
      replies: [
        "你好。我是汐言，汐星札记里的一个小窗口。\n\n随便问点什么吧，也可以直接问我最近在关注什么方向。",
        "在的。\n\n你可以试试问我「北京天气怎么样」，或者问我最近在折腾什么。"
      ]
    },
    {
      cursor: 0,
      test: /你是谁|你叫什么|介绍一下你|你是干什么的|你是什么东西|你是人吗/,
      replies: [
        "我是汐言，Huxleystars 放在汐星札记里的一个小窗口。\n\n老实说，没接入模型的时候我不算真正的 AI——我的回答来自本地预设和这个站点自己的内容。你可以把我理解成一本会开口的目录。",
        "我是汐言。\n\n严格讲，在没配置模型的情况下，我更像一个本地检索工具：从站点的内容里找答案，再加上一点实时数据查询。"
      ]
    },
    {
      cursor: 0,
      test: /你会什么|你能做什么|有什么功能|能帮我做什么|有什么用|能干吗/,
      replies: [
        "没接入模型的时候，我能做三件事：\n\n一、查实时天气——告诉我城市名就行；\n二、从我的笔记里翻出相关段落；\n三、回答关于这个站的问题。\n\n想要完整的对话能力，可以在右上角的设置里接入你自己的模型服务。",
        "目前有三样：查天气、翻笔记、聊这个站。\n\n三个能力都跑在你自己的浏览器里，不会把你的输入发到任何地方。"
      ]
    },
    {
      cursor: 0,
      test: /谢谢|多谢|感谢|辛苦了/,
      replies: [
        "不客气。\n\n有新想法随时回来聊。",
        "举手之劳。有需要再来找我就好。"
      ]
    },
    {
      cursor: 0,
      test: /再见|拜拜|回见|走了|下次聊/,
      replies: [
        "好的，下次再聊。\n\n如果想到什么新问题，随时回来。"
      ]
    }
  ];

  const fallbackReplies = [
    "我先把这个问题拆成三层：想达成的目标、目前的限制，以及今天可以开始验证的最小行动。这样既不会停留在想法，也不会一上来把事情做得过重。",
    "这个方向值得从真实场景开始。先找到一个具体的人、一个具体时刻和一个具体麻烦，再决定 AI 应该负责理解、生成，还是执行。",
    "可以先做一个最小闭环：用户输入信息，汐言完成一次判断或生成，用户得到下一步行动。闭环跑通后，再接知识库、工具调用和自动化流程。",
    "如果要把它落地，我建议先写清楚三件事：谁会使用、什么结果算成功、哪些情况必须交给人来确认。定义清楚后，技术选型会简单很多。",
    "这个问题在本地演示模式下我只能给通用思路。如果你手上有具体背景，说得再细一点，我能给的建议会更贴近实际。",
    "我手上没有关于这件事的资料。你可以试试问我最近在关注什么方向，或者问我某个城市的天气——这两个我是能答上来的。"
  ];

  let replyIndex = 0;

  function localCapability(text) {
    if (/几号|几月几号|今天.*日期|现在.*日期|星期几|周几|礼拜几|现在几点|几点了|什么时间|现在时间/.test(text)) {
      const now = new Date();
      const week = ["日", "一", "二", "三", "四", "五", "六"];
      const pad = value => String(value).padStart(2, "0");
      return `现在是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日，星期${week[now.getDay()]}，${pad(now.getHours())}:${pad(now.getMinutes())}。`;
    }
    return null;
  }

  function answerLocal(text) {
    const capability = localCapability(text);
    if (capability) return capability;
    const rule = DEMO_RULES.find(item => item.test.test(text));
    if (rule) {
      const reply = rule.replies[rule.cursor % rule.replies.length];
      rule.cursor += 1;
      return reply;
    }
    const reply = fallbackReplies[replyIndex % fallbackReplies.length];
    replyIndex += 1;
    return reply;
  }

  /* ==========================================================================
     会话状态与持久化
     ========================================================================== */

  let state = loadState();
  let settings = loadSettings();
  let isBusy = false;

  function defaultThread() {
    return {
      id: uid(),
      title: "新的想法",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
  }
  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.threads) && parsed.threads.length) {
        return { activeId: parsed.activeId || parsed.threads[0].id, threads: parsed.threads };
      }
    } catch (error) { /* Ignore malformed local data and start clean. */ }
    const thread = defaultThread();
    return { activeId: thread.id, threads: [thread] };
  }
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (error) { return {}; }
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  function activeThread() { return state.threads.find(thread => thread.id === state.activeId) || state.threads[0]; }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  /* ==========================================================================
     渲染
     ========================================================================== */

  function renderSessions() {
    const list = $("#session-list");
    const search = ($("#session-search").value || "").trim().toLowerCase();
    const threads = state.threads.filter(thread => thread.title.toLowerCase().includes(search));
    if (!threads.length) {
      list.innerHTML = '<div class="session-empty">没有找到匹配的会话。<br>换个关键词试试。</div>';
      return;
    }
    list.innerHTML = threads
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(thread => `
        <div class="session-item ${thread.id === state.activeId ? "is-active" : ""}" data-thread-id="${thread.id}">
          <div class="session-item-content">
            <div class="session-item-title">${escapeHtml(thread.title)}</div>
            <div class="session-item-meta">${thread.messages.length ? `${thread.messages.length} 条消息 · ` : ""}${nowLabel(thread.updatedAt)}</div>
          </div>
          <button class="session-delete" type="button" data-delete-thread="${thread.id}" aria-label="删除 ${escapeHtml(thread.title)}" title="删除">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>`).join("");
  }
  function renderConversation() {
    const thread = activeThread();
    $("#thread-title").textContent = thread.title;
    const conversation = $("#conversation");
    if (!thread.messages.length) {
      conversation.innerHTML = `
        <div class="welcome">
          <div class="welcome-orbit">汐</div>
          <h3>你好，我是<em>汐言</em></h3>
          <p>把一个问题、一段文字或一个还不成熟的念头交给我。我们从澄清开始，慢慢找到下一步。</p>
        </div>`;
      return;
    }
    conversation.innerHTML = thread.messages.map(message => `
      <article class="message ${message.role}">
        <div class="message-avatar">${message.role === "assistant" ? "汐" : "你"}</div>
        <div class="message-content">
          <p class="message-role">${message.role === "assistant" ? "汐言" : "你"} · ${nowLabel(message.createdAt)}</p>
          <div class="message-bubble"><p>${escapeHtml(message.content)}</p></div>
        </div>
      </article>`).join("");
    scrollToLatest();
  }
  function render() { renderSessions(); renderConversation(); updateConnectionState(); }
  function updateConnectionState() {
    const connected = Boolean(settings.endpoint);
    $("#connection-state").innerHTML = `<i></i> ${connected ? "自定义模型已配置" : "本地演示 · 知识库已就绪"}`;
    $("#model-label").textContent = connected ? (settings.model || "Custom Model") : "Local Demo";
    $("#model-subtitle").textContent = connected ? "将请求发送到已保存的接口" : "内置知识库 + 实时数据";
  }
  function updateThreadTitle(text) {
    const thread = activeThread();
    if (thread.title === "新的想法") {
      thread.title = text.replace(/\s+/g, " ").slice(0, 22) || "新的想法";
    }
  }
  function addMessage(role, content) {
    const thread = activeThread();
    thread.messages.push({ role, content, createdAt: Date.now() });
    thread.updatedAt = Date.now();
    saveState();
    render();
  }
  function addTyping() {
    const conversation = $("#conversation");
    const typing = document.createElement("article");
    typing.className = "message assistant";
    typing.innerHTML = '<div class="message-avatar">汐</div><div class="message-content"><p class="message-role">汐言 · 正在思考</p><div class="message-bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div></div>';
    conversation.appendChild(typing);
    scrollToLatest();
    return typing;
  }

  /* ==========================================================================
     核心：三层应答路由
     ① 访客自建模型（最高优先级，失败时如实报错）
     ② L2 实时数据 → ③ L1 本地知识库 → ④ L0 本地应答
     ②③④ 逐级下落，L0 保证兜底，访客永远不会看到空白或报错。
     ========================================================================== */

  async function requestReply(text) {
    if (settings.endpoint) {
      const headers = { "Content-Type": "application/json" };
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
      const messages = activeThread().messages.map(message => ({ role: message.role, content: message.content }));
      const response = await fetch(settings.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: settings.model || undefined, messages, temperature: .7 })
      });
      if (!response.ok) throw new Error(`接口返回 ${response.status}`);
      const data = await response.json();
      return data.choices?.[0]?.message?.content || data.output_text || "接口已返回，但没有找到可显示的文本。";
    }

    const intent = classifyIntent(text);
    if (intent && PROVIDERS[intent]) {
      try {
        const live = await PROVIDERS[intent](text);
        if (live) {
          await pause(reducedMotion ? 60 : 420);
          return live;
        }
      } catch (error) { /* 接口不可用就安静地交给下一层 */ }
    }

    const entry = searchKnowledge(text);
    if (entry) {
      await pause(reducedMotion ? 60 : 520);
      return `${entry.body}\n\n—— 摘自《${entry.title}》`;
    }

    await pause(reducedMotion ? 60 : 700);
    return answerLocal(text);
  }

  async function sendMessage(content) {
    if (!content || isBusy) return;
    isBusy = true;
    $("#send-button").disabled = true;
    updateThreadTitle(content);
    addMessage("user", content);
    const typing = addTyping();
    try {
      const reply = await requestReply(content);
      typing.remove();
      addMessage("assistant", reply);
    } catch (error) {
      typing.remove();
      addMessage("assistant", `这次连接没有完成：${error.message}。你可以检查接入设置，或先切回本地演示模式。`);
      showToast("模型请求失败，请检查接入设置");
    } finally {
      isBusy = false;
      $("#send-button").disabled = false;
      $("#message-input").focus();
    }
  }
  function clearComposer() {
    const input = $("#message-input");
    input.value = "";
    input.style.height = "auto";
  }
  function openSettings() {
    $("#api-endpoint").value = settings.endpoint || "";
    $("#api-model").value = settings.model || "";
    $("#api-key").value = settings.apiKey || "";
    $("#settings-drawer").classList.add("is-open");
    $("#settings-drawer").setAttribute("aria-hidden", "false");
    $("#api-endpoint").focus();
  }
  function closeSettings() {
    $("#settings-drawer").classList.remove("is-open");
    $("#settings-drawer").setAttribute("aria-hidden", "true");
  }

  /* ==========================================================================
     事件绑定
     ========================================================================== */

  $("#composer").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("#message-input");
    const text = input.value.trim();
    if (!text) return;
    clearComposer();
    sendMessage(text);
  });
  $("#message-input").addEventListener("input", event => {
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 150)}px`;
  });
  $("#message-input").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#composer").requestSubmit(); }
  });
  $("#quick-actions").addEventListener("click", event => {
    const button = event.target.closest("[data-prompt]");
    if (!button) return;
    $("#message-input").value = button.dataset.prompt;
    $("#message-input").dispatchEvent(new Event("input"));
    $("#message-input").focus();
  });
  $("#new-chat").addEventListener("click", () => {
    const thread = defaultThread();
    state.threads.push(thread);
    state.activeId = thread.id;
    saveState(); render(); $("#message-input").focus();
  });
  $("#session-search").addEventListener("input", renderSessions);
  $("#session-list").addEventListener("click", event => {
    const deleteButton = event.target.closest("[data-delete-thread]");
    if (deleteButton) {
      event.stopPropagation();
      if (state.threads.length === 1) { showToast("至少保留一个会话"); return; }
      state.threads = state.threads.filter(thread => thread.id !== deleteButton.dataset.deleteThread);
      if (!state.threads.some(thread => thread.id === state.activeId)) state.activeId = state.threads[0].id;
      saveState(); render(); return;
    }
    const item = event.target.closest("[data-thread-id]");
    if (item) { state.activeId = item.dataset.threadId; saveState(); render(); }
  });
  $("#rename-thread").addEventListener("click", () => {
    const thread = activeThread();
    const title = window.prompt("给这个会话起个名字", thread.title);
    if (title && title.trim()) { thread.title = title.trim().slice(0, 30); thread.updatedAt = Date.now(); saveState(); render(); }
  });
  $("#clear-thread").addEventListener("click", () => {
    if (isBusy) return;
    activeThread().messages = [];
    activeThread().updatedAt = Date.now();
    saveState(); render(); showToast("当前会话已清空");
  });
  $("#clear-all").addEventListener("click", () => {
    if (isBusy || !window.confirm("确定清空全部本地会话吗？")) return;
    const thread = defaultThread();
    state = { activeId: thread.id, threads: [thread] };
    saveState(); render(); showToast("全部会话已清空");
  });
  $("#voice-input").addEventListener("click", () => {
    const button = $("#voice-input");
    button.classList.toggle("is-listening");
    if (button.classList.contains("is-listening")) {
      showToast("语音输入演示已开启");
      window.setTimeout(() => button.classList.remove("is-listening"), 2200);
    }
  });
  $("#settings-open").addEventListener("click", openSettings);
  document.querySelectorAll("[data-close-settings]").forEach(button => button.addEventListener("click", closeSettings));
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeSettings(); });
  $("#settings-form").addEventListener("submit", event => {
    event.preventDefault();
    settings = { endpoint: $("#api-endpoint").value.trim(), model: $("#api-model").value.trim(), apiKey: $("#api-key").value.trim() };
    saveSettings(); updateConnectionState(); closeSettings(); showToast(settings.endpoint ? "模型接入设置已保存" : "已切回本地演示模式");
  });

  const clearSettingsButton = $("#clear-settings");
  if (clearSettingsButton) {
    clearSettingsButton.addEventListener("click", () => {
      settings = {};
      localStorage.removeItem(SETTINGS_KEY);
      $("#api-endpoint").value = "";
      $("#api-model").value = "";
      $("#api-key").value = "";
      updateConnectionState();
      closeSettings();
      showToast("已清除保存的接口地址与密钥");
    });
  }

  render();

  /* 仅供离线单元测试使用：正常访问时 window.__SHEENTALK_TEST__ 不存在，不会执行 */
  if (typeof window !== "undefined" && window.__SHEENTALK_TEST__) {
    window.__sheentalk = { classifyIntent, extractCity, searchKnowledge, answerLocal, weatherAdvice, normalize, requestReply, KNOWLEDGE, PROVIDERS };
  }
})();
