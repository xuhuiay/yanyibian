/* 最小壳页：只做一件事——把内核跑起来并把结论显示出来。
   走的是 window.__TAURI__.core.invoke（tauri.conf.json 的 withGlobalTauri=true），
   不引任何 npm 包、不打包。 */
(function () {
  'use strict';
  var invoke = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || null;
  var el = {
    ruleVersion: document.getElementById('rule-version'),
    templates: document.getElementById('templates'),
    text: document.getElementById('text'),
    statChars: document.getElementById('stat-chars'),
    statEnc: document.getElementById('stat-enc'),
    statCap: document.getElementById('stat-cap'),
    hint: document.getElementById('hint'),
    verdict: document.getElementById('verdict'),
    verdictText: document.getElementById('verdict-text'),
    verdictWhy: document.getElementById('verdict-why'),
    defects: document.getElementById('defects'),
    passes: document.getElementById('passes'),
    btnOpen: document.getElementById('btn-open'),
    btnSample: document.getElementById('btn-sample'),
    btnCheck: document.getElementById('btn-check'),
    aiEnabled: document.getElementById('ai-enabled'),
    aiProvider: document.getElementById('ai-provider'),
    aiModel: document.getElementById('ai-model'),
    aiBase: document.getElementById('ai-base'),
    aiKey: document.getElementById('ai-key'),
    btnAiSave: document.getElementById('btn-ai-save'),
    btnAiClear: document.getElementById('btn-ai-clear'),
    btnAiRun: document.getElementById('btn-ai-run'),
    btnAiCancel: document.getElementById('btn-ai-cancel'),
    aiHint: document.getElementById('ai-hint'),
    aiOut: document.getElementById('ai-out')
  };
  var state = { tpl: '', samples: {}, lastSample: {}, maxUnits: 20000, ruleVersion: '', last: null };

  function setHintOn(node, text, tone) {
    if (!node) return;
    node.textContent = text || '';
    if (tone) node.setAttribute('data-tone', tone);
    else node.removeAttribute('data-tone');
  }
  function setHint(text, tone) { setHintOn(el.hint, text, tone); }
  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.idle) btn.dataset.idle = btn.textContent;
      btn.textContent = label || '处理中…';
      btn.disabled = true;
    } else {
      if (btn.dataset.idle) btn.textContent = btn.dataset.idle;
      btn.disabled = false;
    }
  }
  function units(s) { return s.length; }

  function paintCount() {
    var n = units(el.text.value);
    el.statChars.textContent = n + ' 字';
    if (n > state.maxUnits) {
      el.statCap.textContent = '超出上限 ' + (n - state.maxUnits) + ' 字（上限 ' + state.maxUnits + '）';
      el.statCap.setAttribute('data-tone', 'error');
    } else if (n === state.maxUnits) {
      el.statCap.textContent = '已达上限 ' + state.maxUnits + ' 字';
      el.statCap.setAttribute('data-tone', 'warn');
    } else {
      el.statCap.textContent = '上限 ' + state.maxUnits + ' 字';
      el.statCap.removeAttribute('data-tone');
    }
  }

  function renderTemplates(list) {
    el.templates.textContent = '';
    list.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = t.label || t.id;
      b.title = (t.desc || '') + '（建议 ' + t.maxChars + ' 字）';
      b.setAttribute('aria-pressed', String(t.id === state.tpl));
      b.addEventListener('click', function () { state.tpl = t.id; paintTemplates(list); runCheck(); });
      el.templates.appendChild(b);
    });
  }
  function paintTemplates(list) { renderTemplates(list); }

  function render(res) {
    state.last = res;
    el.verdict.className = 'verdict ' + (res.verdict.cls || '');
    el.verdictText.textContent = res.verdict.text;
    el.verdictWhy.textContent = res.verdict.why;
    el.defects.textContent = '';
    (res.defects || []).forEach(function (d) {
      var li = document.createElement('li');
      li.className = d.sev;
      var b = document.createElement('b');
      b.textContent = d.label;
      var p = document.createElement('p');
      p.textContent = (d.type ? '[' + d.type + '] ' : '') + d.explain;
      li.appendChild(b); li.appendChild(p);
      el.defects.appendChild(li);
    });
    el.passes.textContent = '';
    (res.passes || []).forEach(function (s) {
      var li = document.createElement('li'); li.textContent = s; el.passes.appendChild(li);
    });
  }

  function runCheck() {
    if (!invoke) { setHint('未检测到 Tauri 环境（请在桌面端内打开）', 'error'); return Promise.resolve(); }
    if (!state.tpl) return Promise.resolve();
    var text = el.text.value;
    if (!text.trim()) { setHint('先粘一段要交付的文本', 'error'); return Promise.resolve(); }
    setBusy(el.btnCheck, true, '校验中…');
    return invoke('check_text', { text: text, templateId: state.tpl }).then(function (res) {
      render(res);
      el.statChars.textContent = res.chars + ' 字';
      setHint('校验完成 · 规则版本 ' + (state.ruleVersion || '—'), 'ok');
    }).catch(function (e) {
      var msg = String(e && e.message ? e.message : e);
      setHint(msg, 'error');
      el.verdict.className = 'verdict';
      el.verdictText.textContent = '无法校验';
      el.verdictWhy.textContent = '';
      el.defects.textContent = ''; el.passes.textContent = '';
    }).then(function () { setBusy(el.btnCheck, false); });
  }

  function openFile() {
    if (!invoke) return;
    setBusy(el.btnOpen, true, '打开中…');
    invoke('pick_text_files').then(function (paths) {
      if (!paths || !paths.length) return null;
      return invoke('load_text_file', { path: paths[0] });
    }).then(function (loaded) {
      if (!loaded) return;
      el.text.value = loaded.text;
      el.statEnc.textContent = loaded.encoding;
      setHint('已读入 ' + loaded.name + '（' + loaded.encoding + '）', 'ok');
      paintCount(); runCheck();
    }).catch(function (e) { setHint(String(e && e.message ? e.message : e), 'error'); })
      .then(function () { setBusy(el.btnOpen, false); });
  }

  /* 随机示例：每套模板 3 条以上，连续两次不会抽到同一条 */
  function pickSample() {
    var list = state.samples[state.tpl] || [];
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    var last = state.lastSample[state.tpl];
    var idx = Math.floor(Math.random() * list.length);
    if (last != null && idx === last) idx = (idx + 1) % list.length;
    state.lastSample[state.tpl] = idx;
    return list[idx];
  }
  function fillSample() {
    var s = pickSample();
    if (!s) { setHint('该模板没有内置示例', 'error'); return; }
    el.text.value = s.text;
    el.statEnc.textContent = '示例';
    paintCount();
    var label = '已随机填入示例：' + (s.title || '') + '（共 ' + (state.samples[state.tpl] || []).length + ' 条，再点一次换一条）';
    runCheck().then(function () { setHint(label, 'ok'); });
  }

  /* ---------------- AI 修改（可选通道） ---------------- */
  var ai = { cfg: null, result: null };

  function aiPayload() {
    return {
      enabled: !!el.aiEnabled.checked,
      provider: el.aiProvider.value,
      baseUrl: el.aiBase.value.trim(),
      model: el.aiModel.value.trim(),
      allowFactEdit: false,
      timeoutMs: 20000,
      maxRetry: 1
    };
  }
  function paintAi(cfg) {
    if (!cfg) return;
    ai.cfg = cfg;
    el.aiEnabled.checked = !!cfg.enabled;
    if (cfg.provider) el.aiProvider.value = cfg.provider;
    if (cfg.baseUrl) el.aiBase.value = cfg.baseUrl;
    if (cfg.model) el.aiModel.value = cfg.model;
    el.aiKey.value = '';
    el.aiKey.placeholder = cfg.hasKey ? '已保存（内存）· 留空表示不改' : '只存在本机内存，不落盘、不回显';
    el.btnAiRun.disabled = !cfg.enabled;
    el.btnAiClear.disabled = !cfg.hasKey;
  }
  function loadAi() {
    invoke('ai_get_config').then(paintAi).catch(function (e) {
      setHintOn(el.aiHint, String(e && e.message ? e.message : e), 'error');
    });
  }
  function saveAi() {
    var args = { config: aiPayload() };
    if (el.aiKey.value) args.apiKey = el.aiKey.value;
    setBusy(el.btnAiSave, true, '保存中…');
    invoke('ai_set_config', args).then(function (cfg) {
      paintAi(cfg);
      setHintOn(el.aiHint, cfg.enabled
        ? '已启用 · ' + cfg.provider + ' · 超时 ' + cfg.timeoutMs + ' ms；点「生成修改稿」开始'
        : '已保存。当前为关闭态：勾选「启用」再保存才会联网。', 'ok');
    }).catch(function (e) {
      setHintOn(el.aiHint, String(e && e.message ? e.message : e), 'error');
    }).then(function () { setBusy(el.btnAiSave, false); });
  }
  function clearAiKey() {
    var cfg = aiPayload(); cfg.enabled = false;
    setBusy(el.btnAiClear, true, '清除中…');
    invoke('ai_set_config', { config: cfg, apiKey: '' }).then(function (c) {
      paintAi(c);
      setHintOn(el.aiHint, '已清除内存里的 API Key', 'ok');
    }).catch(function (e) {
      setHintOn(el.aiHint, String(e && e.message ? e.message : e), 'error');
    }).then(function () { setBusy(el.btnAiClear, false); el.btnAiClear.disabled = true; });
  }
  function runAi() {
    if (!state.tpl) { setHintOn(el.aiHint, '先选一个模板', 'error'); return; }
    if (!el.text.value.trim()) { setHintOn(el.aiHint, '先粘一段要交付的文本', 'error'); return; }
    setBusy(el.btnAiRun, true, '生成中…');
    el.btnAiCancel.disabled = false;
    setHintOn(el.aiHint, '正在请求 ' + (el.aiModel.value || '模型') + ' …（可点「取消」）', '');
    invoke('ai_revise', { text: el.text.value, templateId: state.tpl }).then(function (r) {
      renderAi(r);
      setHintOn(el.aiHint, '完成：' + r.elapsedMs + ' ms · ' + (r.model || '—') + ' · 尝试 ' + r.attempts + ' 次', 'ok');
    }).catch(function (e) {
      setHintOn(el.aiHint, String(e && e.message ? e.message : e), 'error');
    }).then(function () {
      setBusy(el.btnAiRun, false);
      el.btnAiRun.disabled = !el.aiEnabled.checked;
      el.btnAiCancel.disabled = true;
    });
  }
  function cancelAi() {
    el.btnAiCancel.disabled = true;
    invoke('ai_cancel').then(function () {
      setHintOn(el.aiHint, '已请求取消，等待当前请求返回…', '');
    });
  }
  function aiHead(title) {
    var h = document.createElement('h4');
    h.textContent = title;
    el.aiOut.appendChild(h);
  }
  function aiList(items) {
    var ul = document.createElement('ul');
    ul.className = 'ai-list';
    items.forEach(function (it) {
      var li = document.createElement('li');
      var b = document.createElement('b');
      b.textContent = it.main;
      li.appendChild(b);
      if (it.sub) { var p = document.createElement('p'); p.textContent = it.sub; li.appendChild(p); }
      ul.appendChild(li);
    });
    el.aiOut.appendChild(ul);
  }
  function renderAi(r) {
    ai.result = r;
    el.aiOut.textContent = '';
    var cmp = document.createElement('div');
    cmp.className = 'ai-cmp';
    cmp.textContent = '修改前：' + r.review.before.verdict + '（高 ' + r.review.before.high + ' / 中 ' + r.review.before.mid + ' / 低 ' + r.review.before.low + ' · ' + r.review.before.chars + ' 字）  →  修改后：' + r.review.after.verdict + '（高 ' + r.review.after.high + ' / 中 ' + r.review.after.mid + ' / 低 ' + r.review.after.low + ' · ' + r.review.after.chars + ' 字）';
    el.aiOut.appendChild(cmp);
    var act = document.createElement('div');
    act.className = 'actions';
    var bApply = document.createElement('button');
    bApply.className = 'btn btn-primary';
    bApply.textContent = '应用到编辑器';
    bApply.disabled = !r.changes.length;
    bApply.addEventListener('click', function () {
      el.text.value = r.revisedText;
      el.statEnc.textContent = 'AI 修改稿';
      paintCount();
      runCheck().then(function () { setHintOn(el.aiHint, '已应用到编辑器，并用内核重新校验（上方结论已刷新）', 'ok'); });
    });
    var bCopy = document.createElement('button');
    bCopy.className = 'btn';
    bCopy.textContent = '复制交付包';
    bCopy.addEventListener('click', function () { copyText(buildDelivery(r)); });
    act.appendChild(bApply);
    act.appendChild(bCopy);
    el.aiOut.appendChild(act);
    aiHead('逐处修改 ' + r.changes.length + ' 处');
    if (r.changes.length) {
      aiList(r.changes.map(function (c) {
        return { main: '[' + (c.kind || '修改') + '] ' + c.before + ' → ' + c.after, sub: c.reason || '' };
      }));
    } else { aiList([{ main: '没有可自动落地的改动' }]); }
    if (r.rejected.length) {
      aiHead('被本地守卫拦下 ' + r.rejected.length + ' 处');
      aiList(r.rejected.map(function (c) { return { main: c.before, sub: c.reason }; }));
    }
    if (r.unresolved.length) {
      aiHead('仍需人工处理 ' + r.unresolved.length + ' 项');
      aiList(r.unresolved.map(function (u) { return { main: u.label, sub: u.why }; }));
    }
  }
  function buildDelivery(r) {
    var out = [];
    out.push('# 验一遍 · AI 修改交付包');
    out.push('');
    out.push('- 模板：' + state.tpl + ' · 模型：' + (r.model || '—') + ' · 用时：' + r.elapsedMs + ' ms · 尝试：' + r.attempts + ' 次');
    out.push('- 复检：' + r.review.before.verdict + '（高 ' + r.review.before.high + ' / 中 ' + r.review.before.mid + ' / 低 ' + r.review.before.low + '）→ ' + r.review.after.verdict + '（高 ' + r.review.after.high + ' / 中 ' + r.review.after.mid + ' / 低 ' + r.review.after.low + '）');
    out.push('');
    out.push('## 一、修改稿');
    out.push('');
    out.push('```text');
    out.push(r.revisedText);
    out.push('```');
    out.push('');
    out.push('## 二、变更说明');
    out.push('');
    out.push('| 类型 | 原文 | 改后 | 理由 |');
    out.push('| --- | --- | --- | --- |');
    r.changes.forEach(function (c) { out.push('| ' + (c.kind || '修改') + ' | ' + c.before + ' | ' + c.after + ' | ' + (c.reason || '') + ' |'); });
    r.rejected.forEach(function (c) { out.push('| 被拦下 | ' + c.before + ' | — | ' + c.reason + ' |'); });
    out.push('');
    out.push('## 三、复检结果');
    out.push('');
    out.push('- 已解决：' + (r.review.resolved.join('、') || '无'));
    out.push('- 仍存在：' + (r.review.remaining.join('、') || '无'));
    if (r.unresolved.length) out.push('- 需人工：' + r.unresolved.map(function (u) { return u.label + '（' + u.why + '）'; }).join('；'));
    return out.join('\n');
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setHintOn(el.aiHint, '已复制交付包到剪贴板', 'ok'); }
      catch (e) { setHintOn(el.aiHint, '复制失败，请手动选中保存', 'error'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { setHintOn(el.aiHint, '已复制交付包到剪贴板', 'ok'); }, fallback);
    } else { fallback(); }
  }
  function bindAi() {
    loadAi();
    el.btnAiSave.addEventListener('click', saveAi);
    el.btnAiClear.addEventListener('click', clearAiKey);
    el.btnAiRun.addEventListener('click', runAi);
    el.btnAiCancel.addEventListener('click', cancelAi);
  }

  function boot() {
    if (!invoke) { setHint('未检测到 Tauri 环境（请在桌面端内打开）', 'error'); return; }
    invoke('api_version').then(function (v) { state.ruleVersion = v; el.ruleVersion.textContent = v; document.title = '验一遍 · 判定内核 · ' + v; });
    invoke('limits_info').then(function (l) { state.maxUnits = l.maxUnits; paintCount(); }).catch(function () {});
    Promise.all([invoke('list_templates'), invoke('list_samples')]).then(function (r) {
      var tpls = r[0], sam = r[1];
      state.tpl = tpls[0].id;
      state.samples = {};
      tpls.forEach(function (t) { state.samples[t.id] = sam.filter(function (s) { return s.tpl === t.id; }); });
      renderTemplates(tpls);
    });
    el.text.addEventListener('input', paintCount);
    el.text.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCheck(); }
    });
    el.btnCheck.addEventListener('click', runCheck);
    el.btnOpen.addEventListener('click', openFile);
    el.btnSample.addEventListener('click', fillSample);
    bindAi();
  }
  boot();
})();