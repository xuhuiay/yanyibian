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
    btnCheck: document.getElementById('btn-check')
  };
  var state = { tpl: '', samples: {}, maxUnits: 20000, ruleVersion: '', last: null };

  function setHint(text, tone) {
    el.hint.textContent = text || '';
    if (tone) el.hint.setAttribute('data-tone', tone);
    else el.hint.removeAttribute('data-tone');
  }
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
    if (!invoke) { setHint('未检测到 Tauri 环境（请在桌面端内打开）', 'error'); return; }
    if (!state.tpl) return;
    var text = el.text.value;
    if (!text.trim()) { setHint('先粘一段要交付的文本', 'error'); return; }
    setBusy(el.btnCheck, true, '校验中…');
    invoke('check_text', { text: text, templateId: state.tpl }).then(function (res) {
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

  function fillSample() {
    var s = state.samples[state.tpl];
    if (!s) { setHint('该模板没有内置示例', 'error'); return; }
    el.text.value = s; paintCount(); runCheck();
  }

  function boot() {
    if (!invoke) { setHint('未检测到 Tauri 环境（请在桌面端内打开）', 'error'); return; }
    invoke('api_version').then(function (v) { state.ruleVersion = v; el.ruleVersion.textContent = v; document.title = '验一遍 · ' + ver; });
    invoke('limits_info').then(function (l) { state.maxUnits = l.maxUnits; paintCount(); }).catch(function () {});
    Promise.all([invoke('list_templates'), invoke('list_samples')]).then(function (r) {
      var tpls = r[0], sam = r[1];
      state.tpl = tpls[0].id;
      tpls.forEach(function (t) { if (sam[t.id]) state.samples[t.id] = sam[t.id]; });
      renderTemplates(tpls);
    });
    el.text.addEventListener('input', paintCount);
    el.text.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCheck(); }
    });
    el.btnCheck.addEventListener('click', runCheck);
    el.btnOpen.addEventListener('click', openFile);
    el.btnSample.addEventListener('click', fillSample);
  }
  boot();
})();