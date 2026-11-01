#!/usr/bin/env node
/* 用 JS 规格真源算出金标准 build/golden.jsonl
   每行：{"id","tpl","hex","expect"}   hex 为 UTF-16LE 码元的十六进制（保真传输，
   含孤立代理对也不会丢），expect 为 YanYiBian.format() 的完整结果。
   用法：node tools/parity/gen-golden.mjs                                          */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../..");
const require = createRequire(import.meta.url);
const YYB = require(resolve(appRoot, "tools/parity/spec/yanyibian.js"));

const lines = readFileSync(resolve(appRoot, "build/corpus.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l));

const out = [];
for (const c of lines) {
  const tpl = YYB.TEMPLATES[c.tpl];
  if (!tpl) throw new Error("unknown template in corpus: " + c.tpl);
  const expect = YYB.format(c.text, tpl);
  out.push({
    id: c.id,
    tpl: c.tpl,
    hex: Buffer.from(c.text, "utf16le").toString("hex"),
    expect,
  });
}

const outPath = resolve(appRoot, "build/golden.jsonl");
writeFileSync(outPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
console.log("[golden] " + out.length + " cases, RULE_VERSION=" + YYB.RULE_VERSION + " -> " + outPath);
