// 通过 WebView2 远程调试端口驱动真实 UI，跑 AI 通道与容量上限的验收序列。
// 用法：node tools/ai-mock/drive.mjs <cdpPort> <mockPort>
import net from "node:net";
import crypto from "node:crypto";
import http from "node:http";

const CDP = Number(process.argv[2] || 9340);
const MOCK = Number(process.argv[3] || 8799);

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

function encode(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}

async function openWs(wsUrl) {
  const u = new URL(wsUrl);
  const sock = net.connect(Number(u.port), u.hostname);
  await new Promise((r) => sock.once("connect", r));
  const key = crypto.randomBytes(16).toString("base64");
  sock.write("GET " + u.pathname + (u.search || "") + " HTTP/1.1\r\nHost: " + u.host +
    "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key +
    "\r\nSec-WebSocket-Version: 13\r\n\r\n");
  let buf = Buffer.alloc(0);
  let upgraded = false;
  const waiters = new Map();
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx < 0) return;
        const head = buf.slice(0, idx).toString("utf8");
        if (!/ 101 /.test(head)) return reject(new Error("handshake failed: " + head));
        upgraded = true;
        buf = buf.slice(idx + 4);
        resolve();
      }
      while (buf.length >= 2) {
        const fin = (buf[0] & 0x80) !== 0;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const data = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (op === 8) { sock.end(); return; }
        if (op !== 1) continue;
        let msg;
        try { msg = JSON.parse(data.toString("utf8")); } catch (e) { continue; }
        if (msg.id && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
        if (!fin) { /* CDP 消息通常单帧；分片时下帧仍是 op=1 的续帧，这里按整帧处理 */ }
      }
    });
    sock.on("error", reject);
  });
  await ready;
  return {
    send(method, params) {
      const id = ++nextId;
      const p = new Promise((res) => waiters.set(id, res));
      sock.write(encode(JSON.stringify({ id, method, params })));
      return p;
    },
    close() { sock.end(); },
  };
}

async function main() {
  const list = await getJson("http://127.0.0.1:" + CDP + "/json");
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = await openWs(page.webSocketDebuggerUrl);
  await ws.send("Page.enable", {});
  const ev = async (expr) => {
    const r = await ws.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      return { exception: r.result.exceptionDetails.text + " / " + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || "") };
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const stats = () => getJson("http://127.0.0.1:" + MOCK + "/__stats");
  const reset = () => getJson("http://127.0.0.1:" + MOCK + "/__reset");

  const out = { steps: [] };
  const step = async (name, expr) => {
    const v = await ev(expr);
    out.steps.push({ name, value: v });
    return v;
  };

  const cfgBase = "{enabled:true,provider:'custom',baseUrl:'http://127.0.0.1:" + MOCK + "/v1',model:'mock-model',allowFactEdit:false,timeoutMs:3000,maxRetry:1}";

  // 1. 默认关闭
  await step("config_default", "invoke('ai_get_config')");
  // 2. 关闭时调用 -> E_AI_OFF（且不产生网络请求）
  await reset();
  await step("off_returns", "(async()=>{try{await invoke('ai_revise',{text:'全面赋能。MOCK_MODE=ok',templateId:'weekly'});return 'NO_ERROR'}catch(e){return String(e)}})()");
  out.offRequests = (await stats()).count;

  // 3. 保存配置
  await step("config_set", "invoke('ai_set_config',{config:" + cfgBase + ",apiKey:'test-key'})");

  const TXT = "'本周完成数据采集脚本重构，采集速度提升 40%，整体流程更加顺畅。\\n下周计划把三条试点记录补齐，并同步更新标注规范。\\n整个方案全面赋能后续实验，效率显著提升！MOCK_MODE=ok'";
  // 4. 正常路径
  await reset();
  await step("ok_revise", "(async()=>{const t=" + TXT + ";const r=await invoke('ai_revise',{text:t,templateId:'weekly'});return {changes:r.changes.length,rejected:r.rejected.length,revised:r.revisedText,before:r.review.before.verdict,after:r.review.after.verdict,beforeHigh:r.review.before.high,afterHigh:r.review.after.high,resolved:r.review.resolved,remaining:r.review.remaining,elapsed:r.elapsedMs,attempts:r.attempts,maxUnits:r.maxUnits}})()");
  out.okStats = (await stats()).calls[0];

  // 5. 数字守卫
  await step("fact_guard", "(async()=>{const t='效率提升 40%，继续。MOCK_MODE=fact';const r=await invoke('ai_revise',{text:t,templateId:'weekly'});return {changes:r.changes.length,rejected:r.rejected,revised:r.revisedText}})()");

  // 6. 重复片段守卫
  await step("dup_guard", "(async()=>{const t='提升效率，提升质量。MOCK_MODE=dup';const r=await invoke('ai_revise',{text:t,templateId:'weekly'});return {changes:r.changes.length,rejected:r.rejected}})()");

  // 7. 坏 JSON
  await step("bad_json", "(async()=>{try{await invoke('ai_revise',{text:'全面赋能。MOCK_MODE=badjson',templateId:'weekly'});return 'NO_ERROR'}catch(e){return String(e)}})()");

  // 8. 400 不重试
  await reset();
  await step("http_400", "(async()=>{try{await invoke('ai_revise',{text:'全面赋能。MOCK_MODE=e400',templateId:'weekly'});return 'NO_ERROR'}catch(e){return String(e)}})()");
  out.http400Calls = (await stats()).count;

  // 9. 500 重试后成功
  await reset();
  await step("http_500_retry", "(async()=>{try{const r=await invoke('ai_revise',{text:'全面赋能。MOCK_MODE=s500',templateId:'weekly'});return {changes:r.changes.length,attempts:r.attempts}}catch(e){return 'ERR:'+String(e)}})()");
  out.s500Calls = (await stats()).count;

  // 9b. 429 重试后成功
  await reset();
  await step("http_429_retry", "(async()=>{try{const r=await invoke('ai_revise',{text:'全面赋能。MOCK_MODE=e429',templateId:'weekly'});return {changes:r.changes.length,attempts:r.attempts}}catch(e){return 'ERR:'+String(e)}})()");
  out.e429Calls = (await stats()).count;

  // 9c. 没有缺陷时不调用
  await reset();
    await step("nothing_to_fix", "(async()=>{try{const NL=String.fromCharCode(10);await invoke('ai_revise',{text:['本周完成了试点复盘。','下周计划补齐三条记录。','风险：样本偏少。'].join(NL),templateId:'weekly'});return 'NO_ERROR'}catch(e){return String(e)}})()");
  out.nothingCalls = (await stats()).count;

  // 10. 超时（timeoutMs=3000，重试 1 次 => 约 6s）
  await reset();
  await step("timeout", "(async()=>{const t0=Date.now();try{await invoke('ai_revise',{text:'全面赋能。MOCK_MODE=slow',templateId:'weekly'});return 'NO_ERROR'}catch(e){return String(e)+' after '+(Date.now()-t0)+'ms'}})()");
  out.slowCalls = (await stats()).count;

  // 11. 容量边界（20000 码元）
  await step("cap_20000_exact", "(async()=>{const t='字'.repeat(20000);const r=await invoke('check_text',{text:t,templateId:'weekly'});return {chars:r.chars,verdict:r.verdict.text}})()");
  await step("cap_20001_over", "(async()=>{try{await invoke('check_text',{text:'字'.repeat(20001),templateId:'weekly'});return 'NO_ERROR'}catch(e){return String(e)}})()");
  await step("cap_emoji", "(async()=>{try{await invoke('check_text',{text:'😀'.repeat(10001),templateId:'weekly'});return 'NO_ERROR'}catch(e){return String(e)}})()");
  await step("cap_empty", "(async()=>{const r=await invoke('check_text',{text:'',templateId:'weekly'});return {chars:r.chars,verdict:r.verdict.text,defects:r.defects.map(d=>d.label)}})()");

  // 12. 关闭后不再联网
  await reset();
  await step("config_off", "invoke('ai_set_config',{config:{enabled:false,provider:'custom',baseUrl:'http://127.0.0.1:" + MOCK + "/v1',model:'mock-model',allowFactEdit:false,timeoutMs:3000,maxRetry:1},apiKey:null})");
  await step("off_again", "(async()=>{try{await invoke('ai_revise',{text:'全面赋能。MOCK_MODE=ok',templateId:'weekly'});return 'NO_ERROR'}catch(e){return String(e)}})()");
  out.offAgainRequests = (await stats()).count;

  // 13. 未填 Key 时拒绝启用
  await step("no_key_rejected", "(async()=>{try{await invoke('ai_set_config',{config:{enabled:true,provider:'custom',baseUrl:'http://127.0.0.1:8799/v1',model:'mock-model',allowFactEdit:false,timeoutMs:3000,maxRetry:1},apiKey:''});return 'NO_ERROR'}catch(e){return String(e)}})()");

  console.log(JSON.stringify(out, null, 2));
  ws.close();
}

main().catch((e) => { console.error("FAIL", e); process.exit(1); });
