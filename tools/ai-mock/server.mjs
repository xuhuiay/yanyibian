// 假的 OpenAI 兼容服务端：只用于本地验收 AI 通道（不进产品包）。
// 用法：node tools/ai-mock/server.mjs [port]；GET /__stats 看调用记录，GET /__reset 清零。
import http from "node:http";

const PORT = Number(process.argv[2] || process.env.MOCK_PORT || 8799);
const KEY = process.env.MOCK_KEY || "test-key";
const T0 = Date.now();
let calls = [];
let seq = {};

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function ok(res, revisions, unresolved) {
  const content = JSON.stringify({ revisions: revisions || [], unresolved: unresolved || [] });
  send(res, 200, {
    id: "mock-" + calls.length,
    model: "mock-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
}

const srv = http.createServer((req, res) => {
  if (req.url === "/__stats") {
    return send(res, 200, { uptimeMs: Date.now() - T0, count: calls.length, calls, seq });
  }
  if (req.url === "/__reset") {
    calls = []; seq = {};
    return send(res, 200, { ok: true });
  }
  if (req.method !== "POST" || !String(req.url).endsWith("/chat/completions")) {
    return send(res, 404, { error: "not found" });
  }
  let raw = "";
  req.on("data", (d) => { raw += d; });
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw); } catch (e) { /* 用空对象继续，测坏请求 */ }
    const auth = String(req.headers["authorization"] || "");
    const user = (body.messages && body.messages[1] && body.messages[1].content) || "";
    const m = user.match(/MOCK_MODE=([a-z0-9]+)/);
    const mode = m ? m[1] : "ok";
    const rec = {
      mode,
      at: Date.now() - T0,
      authOk: auth === "Bearer " + KEY,
      authPrefix: auth.slice(0, 12),
      model: body.model || "",
      bytes: Buffer.byteLength(raw),
      temperature: body.temperature,
      responseFormat: !!(body.response_format && body.response_format.type),
      leaksPath: /[A-Za-z]:\\|\/tmp\/|\.docx\b/.test(user),
      hasSystem: !!(body.messages && body.messages[0] && body.messages[0].role === "system"),
    };
    calls.push(rec);

    if (!rec.authOk) return send(res, 401, { error: { message: "bad key" } });

    if (mode === "fact") {
      return ok(res, [{ type: "事实一致性", before: "提升 40%", after: "提升 45%", reason: "改数字（应被守卫拦下）" }]);
    }
    if (mode === "dup") {
      return ok(res, [{ type: "禁用项", before: "提升", after: "提高", reason: "片段重复（应被守卫拦下）" }]);
    }
    if (mode === "badjson") {
      return send(res, 200, {
        choices: [{ message: { role: "assistant", content: "抱歉，我无法按格式返回。" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    }
    if (mode === "s500") {
      seq.s500 = (seq.s500 || 0) + 1;
      if (seq.s500 <= 1) return send(res, 500, { error: { message: "mock 500" } });
      return ok(res, [{ type: "禁用项", before: "赋能", after: "支持", reason: "重试后成功" }]);
    }
    if (mode === "e429") {
      seq.e429 = (seq.e429 || 0) + 1;
      if (seq.e429 <= 1) return send(res, 429, { error: { message: "mock 429" } });
      return ok(res, [{ type: "禁用项", before: "赋能", after: "支持", reason: "429 后重试成功" }]);
    }
    if (mode === "e400") {
      return send(res, 400, { error: { message: "mock 400 bad request" } });
    }
    if (mode === "slow" || mode === "cancel") {
      const wait = mode === "cancel" ? 1500 : 5000;
      return setTimeout(() => ok(res, [{ type: "禁用项", before: "赋能", after: "支持", reason: "慢响应" }]), wait);
    }
    // 默认 ok：修掉禁用项「赋能」，并给一条 unresolved
    return ok(
      res,
      [{ type: "禁用项", before: "赋能", after: "支持", reason: "把套话换成中性词" }],
      [{ label: "量化断言 2 处", why: "涉及数据，按规则不自动改" }]
    );
  });
});

srv.listen(PORT, "127.0.0.1", () => {
  console.log("[mock] listening http://127.0.0.1:" + PORT + "/v1  key=" + KEY);
});
