// 本地假的 OpenAI 兼容服务，仅供 AI 通道验收（不联网、不对外）。
// 用法：node tools/ai-mock/server.mjs   （KEY=test-key PORT=8799）
import http from 'node:http';

const PORT = Number(process.env.PORT || 8799);
const KEY = process.env.KEY || 'test-key';
let calls = [];

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

function modeOf(text) {
  const m = /MOCK_MODE=([a-z0-9_]+)/i.exec(text || '');
  return m ? m[1].toLowerCase() : 'ok';
}

function revisionsFor(mode) {
  switch (mode) {
    case 'fact':
      return { revisions: [{ type: '事实一致性', before: '提升 40%', after: '提升 45%', reason: 'mock 故意改数字，用于验证本地守卫' }], unresolved: [] };
    case 'dup':
      return { revisions: [{ type: '禁用项', before: '提升', after: '提高', reason: 'mock 重复片段' }], unresolved: [] };
    case 'nothing':
      return { revisions: [], unresolved: [{ label: '缺「风险」', why: 'mock：需要人工补一段' }] };
    default:
      return { revisions: [{ type: '禁用项', before: '赋能', after: '支持', reason: 'mock：换成具体动作' }], unresolved: [{ label: '缺「风险」', why: 'mock：需要人工补一段' }] };
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__stats') return json(res, 200, { calls });
  if (req.method === 'GET' && req.url === '/__reset') { calls = []; return json(res, 200, { ok: true }); }
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) return json(res, 404, { error: 'not found' });

  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const auth = req.headers['authorization'] || '';
    let body = {};
    try { body = JSON.parse(raw); } catch (e) { body = {}; }
    const user = Array.isArray(body.messages) ? body.messages.map((m) => m && m.content).join('\n') : '';
    const mode = modeOf(user);
    const rec = { mode, authOk: auth === 'Bearer ' + KEY, model: body.model, bytes: Buffer.byteLength(raw), temperature: body.temperature, responseFormat: !!(body.response_format && body.response_format.type === 'json_object'), leaksPath: /[A-Za-z]:\\\\|\/home\/|AppData/i.test(user) };
    calls.push(rec);

    if (!rec.authOk) return json(res, 401, { error: { message: 'bad key' } });
    if (mode === 'e400') return json(res, 400, { error: { message: 'mock 400' } });
    if (mode === 'e500') return json(res, 500, { error: { message: 'mock 500' } });
    if (mode === 'badjson') return json(res, 200, { model: body.model, choices: [{ message: { content: 'not json at all' } }], usage: { total_tokens: 1 } });

    const content = JSON.stringify(revisionsFor(mode));
    const send = () => json(res, 200, {
      model: body.model || 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });
    if (mode === 'slow' || mode === 'cancel') return setTimeout(send, 1500);
    return send();
  });
});

server.listen(PORT, '127.0.0.1', () => console.log('[mock] listening on 127.0.0.1:' + PORT + ' key=' + KEY));