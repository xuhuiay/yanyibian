#!/usr/bin/env node
/* 生成差分语料 build/corpus.jsonl
   覆盖：示例文本 / 空与空白 / 长度边界 / 要素正则扫描 / 禁用词 / 感叹号 / 段落 /
        量化与绝对化 / 代理对与换行变体 / 固定种子随机文本
   用法：node tools/parity/gen-corpus.mjs                                            */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../..");
const require = createRequire(import.meta.url);
const YYB = require(resolve(appRoot, "tools/parity/spec/yanyibian.js"));

const TPLS = Object.keys(YYB.TEMPLATES);

/* 0. 示例数量契约：每套模板至少 3 条示例，否则门禁直接失败（v1.8 起） */
for (const tpl of TPLS) {
  const n = YYB.SAMPLES.filter((s) => s.tpl === tpl).length;
  if (n < 3) throw new Error(`模板 ${tpl} 只有 ${n} 条示例，要求至少 3 条`);
}
for (const s of YYB.SAMPLES) {
  if (!YYB.TEMPLATES[s.tpl]) throw new Error(`示例 ${s.title} 引用了未知模板 ${s.tpl}`);
}

const cases = [];
let seq = 0;
const add = (tpl, text) => {
  cases.push({ id: "c" + String(++seq).padStart(4, "0"), tpl, text });
};

/* 1. 示例文本：每套 3 条、共 15 条，跨全部模板各跑一遍（15 x 5 = 75） */
for (const s of YYB.SAMPLES) {
  for (const tpl of TPLS) add(tpl, s.text);
}

/* 2. 空与纯空白 */
const blanks = ["", " ", "\n", "\n\n", "\t \r\n ", "\u3000", "\u00a0\u00a0", "\ufeff"];
for (const tpl of TPLS) for (const b of blanks) add(tpl, b);

/* 3. 长度边界：maxChars-1 / maxChars / maxChars+1（单段与双段各一份） */
for (const tpl of TPLS) {
  const max = YYB.TEMPLATES[tpl].maxChars;
  for (const n of [max - 1, max, max + 1]) {
    const body = "字".repeat(n);
    add(tpl, body);
    add(tpl, body.slice(0, Math.floor(n / 2)) + "\n" + body.slice(Math.floor(n / 2)));
  }
  add(tpl, "甲".repeat(5000)); /* 超长：检验 indexAtCharCount 的定位 */
}

/* 4. 要素正则扫描 */
const timeHits = ["11月9日", "9月9日", "1/2", "12/31", "3-4", "9:30", "9：30", "9 点 30",
  "周一", "周日", "周末", "今天", "明天", "后天", "本周", "13月40日", "9 月 9 日", "0/0"];
const timeMiss = ["第9周", "下周", "上午", "九点", "本月", "月日", "99"];
for (const t of [...timeHits, ...timeMiss]) add("notice", "请大家注意：" + t + "，全体成员参会。");
const placeHits = ["楼", "室", "厅", "馆", "地点", "地址", "线上", "腾讯会议", "会议室", "教室"];
const placeMiss = ["现场", "线上会议", "大堂"];
for (const t of [...placeHits, ...placeMiss]) add("notice", "请全体成员于 9:30 到" + t + "参会。");
const objHits = ["全体", "各位", "同学们", "成员", "部门", "参加", "参会", "报名"];
const objMiss = ["个人", "自己"];
for (const t of [...objHits, ...objMiss]) add("notice", "请" + t + "于 9:30 到会议室。");
const reqHits = ["请", "须", "务必", "截止", "需要", "携带", "提交", "填写"];
for (const t of [...reqHits, "随意"]) add("notice", "全体成员" + t + "于 9:30 到会议室。");
const weeklyWords = ["进度", "进展", "已完成", "完成", "做完", "计划", "下一步", "下周",
  "明天", "接下来", "准备", "风险", "问题", "阻塞", "卡点", "阻塞项", "需要支持", "隐患"];
for (const w of weeklyWords) add("weekly", "本周" + w + "：数据采集脚本重构。" + w + "已同步。\n下周继续。");
const readmeWords = ["背景", "问题", "现状", "为什么", "起因", "目标", "目的", "要解决",
  "做到", "希望", "使用", "用法", "步骤", "运行", "怎么用", "安装", "打开", "限制",
  "风险", "已知问题", "注意", "暂不支持", "待补充"];
for (const w of readmeWords) add("readme", "这是" + w + "部分。\n第二段说明" + w + "。");

/* 5. 禁用词：每个模板 × 每个词，单次与重复两次 */
for (const tpl of TPLS) {
  for (const w of YYB.TEMPLATES[tpl].banned) {
    add(tpl, "第一段" + w + "。\n第二段" + w + w + "。");
  }
}

/* 6. 感叹号个数 0..3，全角与半角混排 */
for (const tpl of TPLS) {
  add(tpl, "第一段。\n第二段！！！");
  add(tpl, "第一段！\n第二段!!");
  add(tpl, "第一段\n第二段！!！");
  add(tpl, "第一段\n第二段！!！!");
}

/* 7. 段落数 1..4（含行内多个换行、结尾换行） */
for (const tpl of TPLS) {
  add(tpl, "只有一段，进度计划风险都写了。");
  add(tpl, "一段\n\n\n二段。");
  add(tpl, "一段\r\n二段\r\n三段。");
  add(tpl, "一段\n二段\n三段\n");
  add(tpl, "  \n 一段 \n 二段 \n ");
}

/* 8. 量化断言与绝对化表述 */
const quantBits = ["提升 40%", "提升40%", "增长12", "增长 12%", "降低 5", "提高3", "提高 3",
  "40 %", "40.5%", "3%", "abc%", "提升abc", "提升　40", "高了 3 个点", "0%"];
for (const b of quantBits) add("general", "第一段：本季度" + b + "。\n第二段：口径待补充。");
const absBits = ["一定能", "绝对", "必然", "百分之百", "完全可以", "彻底解决", "前所未有的",
  "一定", "必须", "肯定"];
for (const b of absBits) add("general", "第一段：" + b + "可以做到。\n第二段：继续观察。");

/* 9. 代理对 / 组合字符 / BOM / 特殊空白 */
for (const tpl of TPLS) {
  add(tpl, "进度 😀😀 计划\n风险 😀");
  add(tpl, "\ufeff进度计划风险\n第二段");
  add(tpl, "进度\u200b计划\n第二段");     /* 零宽空格：JS \s 不含，不计空白 */
  add(tpl, "进度\u2003计划\n第二段");     /* EM SPACE：JS \s 含 */
  add(tpl, "进度\u2028计划\u2029风险");
}

/* 10. 固定种子随机文本 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const rnd = lcg(20261101);
const pool = ["进度", "计划", "风险", "完成", "下周", "赋能", "闭环", "抓手", "！", "!", "。",
  "，", "\n", " ", "  ", "\t", "9", "11", "月", "日", ":", "：", "%", "提升", "增长",
  "40", "3", "室", "请", "全体", "背景", "目标", "使用", "限制", "😀", "a", "Z", "\u3000"];
for (let i = 0; i < 220; i++) {
  const tpl = TPLS[i % TPLS.length];
  const n = 1 + Math.floor(rnd() * 60);
  let s = "";
  for (let k = 0; k < n; k++) s += pool[Math.floor(rnd() * pool.length)];
  add(tpl, s);
}

const outDir = resolve(appRoot, "build");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "corpus.jsonl");
writeFileSync(outPath, cases.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");
console.log("[corpus] " + cases.length + " cases -> " + outPath);
