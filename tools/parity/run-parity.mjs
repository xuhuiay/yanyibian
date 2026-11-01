#!/usr/bin/env node
/* 逐键 deep-equal 一致性命门
   1) 读 build/golden.jsonl（JS 真源结果）
   2) 写成 build/cases.tab（模板ID \t UTF-16LE hex），交给 C++ 内核 CLI
   3) 逐条对比 verdict / chars / defects / passes / requiredHit / ranges
     —— 任一路径、任一段文字不同即失败，并打印首个差异位置
   用法：node tools/parity/run-parity.mjs [--cli <path>]                              */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../..");

const argv = process.argv.slice(2);
const cliIdx = argv.indexOf("--cli");
const cliPath = cliIdx >= 0 ? resolve(argv[cliIdx + 1]) : resolve(appRoot, "core/build/yyb-cli.exe");

if (!existsSync(cliPath)) {
  console.error("[parity] 找不到内核 CLI：" + cliPath);
  console.error("[parity] 先跑 core/build-cli.bat（Windows）或等价编译命令。");
  process.exit(2);
}

const golden = readFileSync(resolve(appRoot, "build/golden.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l));

writeFileSync(
  resolve(appRoot, "build/cases.tab"),
  golden.map((g) => g.tpl + "\t" + g.hex).join("\n") + "\n",
  "utf8"
);

const version = spawnSync(cliPath, ["--version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error("[parity] yyb-cli --version 失败：" + (version.stderr || ""));
  process.exit(2);
}
const cliVersion = (version.stdout || "").trim();
const rules = JSON.parse(readFileSync(resolve(appRoot, "build/rulemeta.json"), "utf8"));
if (cliVersion !== rules.ruleVersion) {
  console.error("[parity] RULE_VERSION 不一致：JS=" + rules.ruleVersion + " C++=" + cliVersion);
  process.exit(3);
}

const run = spawnSync(cliPath, ["--tab", resolve(appRoot, "build/cases.tab")], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 256,
});
if (run.status !== 0) {
  console.error("[parity] yyb-cli --tab 失败，退出码 " + run.status + "：" + (run.stderr || ""));
  process.exit(2);
}
const got = (run.stdout || "").split("\n").filter((l) => l.trim().length > 0);

if (got.length !== golden.length) {
  console.error("[parity] 行数不一致：golden " + golden.length + "，C++ " + got.length);
  process.exit(3);
}

function deepEqual(a, b, path, diffs) {
  if (diffs.length >= 30) return;
  if (a === b) return;
  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) {
    diffs.push({ path, js: a, cpp: b });
    return;
  }
  if (ta === "array") {
    if (a.length !== b.length) {
      diffs.push({ path: path + ".length", js: a.length, cpp: b.length });
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) deepEqual(a[i], b[i], path + "[" + i + "]", diffs);
    return;
  }
  if (ta === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join(",") !== kb.join(",")) {
      diffs.push({ path: path + ".keys", js: ka, cpp: kb });
    }
    for (const k of ka) if (k in b) deepEqual(a[k], b[k], path + "." + k, diffs);
    return;
  }
  diffs.push({ path, js: a, cpp: b });
}

let failed = 0;
const report = [];
for (let i = 0; i < golden.length; i++) {
  let parsed;
  try {
    parsed = JSON.parse(got[i]);
  } catch (e) {
    failed++;
    report.push({ id: golden[i].id, tpl: golden[i].tpl, diffs: [{ path: "<parse>", js: "ok", cpp: got[i].slice(0, 200) }] });
    continue;
  }
  const diffs = [];
  deepEqual(golden[i].expect, parsed, "$", diffs);
  if (diffs.length > 0) {
    failed++;
    report.push({ id: golden[i].id, tpl: golden[i].tpl, diffs });
  }
}

if (failed === 0) {
  console.log("[parity] PASS  " + golden.length + "/" + golden.length + " 一致（RULE_VERSION=" + cliVersion + "）");
  process.exit(0);
}

console.error("[parity] FAIL  " + failed + "/" + golden.length + " 不一致");
for (const r of report.slice(0, 8)) {
  console.error("  - " + r.id + " (" + r.tpl + ")");
  for (const d of r.diffs.slice(0, 6)) {
    console.error("      " + d.path + "\n        JS : " + JSON.stringify(d.js) + "\n        C++: " + JSON.stringify(d.cpp));
  }
}
process.exit(1);
