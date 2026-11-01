#!/usr/bin/env node
/* 从 JS 真源导出 build/rulemeta.json（供 run-parity 校验两端版本号） */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../..");
const require = createRequire(import.meta.url);
const YYB = require(resolve(appRoot, "tools/parity/spec/yanyibian.js"));

mkdirSync(resolve(appRoot, "build"), { recursive: true });
writeFileSync(
  resolve(appRoot, "build/rulemeta.json"),
  JSON.stringify({ ruleVersion: YYB.RULE_VERSION, templates: Object.keys(YYB.TEMPLATES) }, null, 2),
  "utf8"
);
console.log("[rulemeta] RULE_VERSION=" + YYB.RULE_VERSION);
