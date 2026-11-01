#!/usr/bin/env node
/* 生成应用图标（零依赖）：512 母版 → 32/128/256 PNG + icon.ico。
   画法：墨色圆角方块 + 朱红对勾，3x3 超采样抗锯齿。
   用法：node tools/make-icon.mjs   输出到 src-tauri/icons/ */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const outDir = resolve(appRoot, "src-tauri/icons");
mkdirSync(outDir, { recursive: true });

/* ---------- 绘制 ---------- */
const INK = [27, 26, 24];
const PAPER = [253, 250, 243];
const RED = [179, 58, 43];

function inRoundRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
  t = Math.min(1, Math.max(0, t));
  const dx = px - (x1 + t * vx);
  const dy = py - (y1 + t * vy);
  return Math.hypot(dx, dy);
}

/** 返回 [r,g,b,a]，坐标为 0..1 归一化 */
function sample(u, v) {
  const inside = inRoundRect(u, v, 1, 1, 0.22);
  if (!inside) return [0, 0, 0, 0];
  const pad = 0.13;
  const tone = inRoundRect(u, v, 1, 1, 0.22) && inRoundRect(u + pad * 0.5, v + pad * 0.5, 1 - pad, 1 - pad, 0.16);
  const paper = tone && !onStroke(u, v) ? PAPER : null;
  if (onStroke(u, v)) return [...RED, 255];
  if (tone) return [...INK, 255];
  return [...PAPER, 0];
}

const S1 = [0.28, 0.52, 0.44, 0.68];
const S2 = [0.44, 0.68, 0.74, 0.30];
const W = 0.052;

function onStroke(u, v) {
  if (!inRoundRect(u, v, 1, 1, 0.22)) return false;
  const inner = inRoundRect(u, v, 1, 1, 0.22);
  const d1 = distToSeg(u, v, S1[0], S1[1], S1[2], S1[3]);
  const d2 = distToSeg(u, v, S2[0], S2[1], S2[2], S2[3]);
  return inner && (d1 <= W || d2 <= W);
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = sample(u, v);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      if (a === 0) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
      } else {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round(a / n);
      }
    }
  }
  return px;
}

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- ICO 容器（内嵌 PNG，Vista+ 支持） ---------- */
function encodeIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d[2] = 0;
    d[3] = 0;
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dir.push(d);
  }
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.png)]);
}

/* ---------- 输出 ---------- */
const master = render(256);
const png256 = encodePng(256, master);
writeFileSync(resolve(outDir, "icon.png"), png256);

for (const size of [32, 128]) {
  writeFileSync(resolve(outDir, size + "x" + size + ".png"), encodePng(size, render(size)));
}

const png32 = encodePng(32, render(32));
const png48 = encodePng(48, render(48));
writeFileSync(resolve(outDir, "icon.ico"), encodeIco([
  { size: 32, png: png32 },
  { size: 48, png: png48 },
  { size: 256, png: png256 },
]));

console.log("[icon] -> " + outDir);
