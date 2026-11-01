// UI 级验收：在真实 WebView2 里点按钮走完 AI 修改流程并截图。
// 用法：node tools/ai-mock/drive-ui.mjs <cdpPort> <mockPort> <shotPath>
import net from "node:net";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";

const CDP = Number(process.argv[2] || 9340);
const MOCK = Number(process.argv[3] || 8799);
const SHOT = process.argv[4] || "D:/tmp-m5/ai-gui.png";

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on("error", reject);
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
  let buf = Buffer.alloc(0), upgraded = false, nextId = 0;
  const waiters = new Map();
  await new Promise((resolve, reject) => {
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx < 0) return;
        if (!/ 101 /.test(buf.slice(0, idx).toString("utf8"))) return reject(new Error("handshake"));
        upgraded = true; buf = buf.slice(idx + 4); resolve();
      }
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const data = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (op !== 1) continue;
        let msg; try { msg = JSON.parse(data.toString("utf8")); } catch (e) { continue; }
        if (msg.id && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
      }
    });
    sock.on("error", reject);
  });
  return {
    send(method, params) { const id = ++nextId; const p = new Promise((res) => waiters.set(id, res)); sock.write(encode(JSON.stringify({ id, method, params }))); return p; },
    close() { sock.end(); },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await getJson("http://127.0.0.1:" + CDP + "/json");
  const page = list.find((t) => t.type === "page");
  const ws = await openWs(page.webSocketDebuggerUrl);
  await ws.send("Page.enable", {});
  const ev = async (expr) => {
    const r = await ws.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { exception: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const out = {};

  // 1. 填配置 + 保存
  out.save = await ev("(async()=>{document.querySelector('#ai-enabled').checked=true;" +
    "document.querySelector('#ai-base').value='http://127.0.0.1:" + MOCK + "/v1';" +
    "document.querySelector('#ai-model').value='mock-model';" +
    "document.querySelector('#ai-key').value='test-key';" +
    "document.querySelector('#btn-ai-save').click();" +
    "await new Promise(r=>setTimeout(r,600));" +
    "return {status:document.querySelector('#ai-status').textContent,hint:document.querySelector('#ai-hint').textContent}})()");

  // 2. 灌正文并等防抖校验
  const sample = fs.readFileSync("D:/双百工程/yanyibian-app/build/smoke-weekly.txt", "utf8");
  out.fill = await ev("(async()=>{const t=document.querySelector('#text');t.value=" + JSON.stringify(sample) + ";" +
    "t.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,1200));" +
    "return {chars:document.querySelector('#stat-chars').textContent,verdict:document.querySelector('#verdict-text').textContent," +
    "aiDisabled:document.querySelector('#btn-ai').disabled}})()");

  // 3. 点「让 AI 生成修改稿」并等渲染
  out.run = await ev("(async()=>{document.querySelector('#btn-ai').click();" +
    "for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,200));" +
    "if(document.querySelector('#ai-out').textContent.trim().length>0||/失败/.test(document.querySelector('#ai-hint').textContent))break;}" +
    "const q=(s)=>document.querySelectorAll(s).length;" +
    "return {hint:document.querySelector('#ai-hint').textContent," +
    "compare:(document.querySelector('.ai-compare')||{textContent:''}).textContent," +
    "changes:q('.ai-diff li'),rejected:q('.ai-reject li'),lists:q('.ai-list li')," +
    "hasApply:!!document.querySelector('#btn-ai-apply'),hasExport:!!document.querySelector('#btn-ai-export')," +
    "outText:document.querySelector('#ai-out').textContent.slice(0,300)}})()");

  // 4. 应用到编辑器 -> 正文变为修改稿并复检
  out.apply = await ev("(async()=>{const b=document.querySelector('#btn-ai-apply');if(!b)return 'NO_BUTTON';b.click();" +
    "await new Promise(r=>setTimeout(r,1500));" +
    "return {tail:document.querySelector('#text').value.slice(-60),chars:document.querySelector('#stat-chars').textContent," +
    "verdict:document.querySelector('#verdict-text').textContent,hint:document.querySelector('#ai-hint').textContent}})()");

  // 5. 截图
  const shot = await ws.send("Page.captureScreenshot", { format: "png" });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
    out.shot = SHOT + " " + fs.statSync(SHOT).size + "B";
  }
  const st = await getJson("http://127.0.0.1:" + MOCK + "/__stats");
  out.mock = { count: st.count, last: st.calls[st.calls.length - 1] };
  console.log(JSON.stringify(out, null, 2));
  ws.close();
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
