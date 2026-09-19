#!/usr/bin/env node
/**
 * trace-gb-logo —— 把 GB 标志源位图（tools/gb-logo.src.png）描迹成矢量 SVG。
 *
 * 源位图的来历（一次性取证，勿删）：
 *   pdftoppm -r 600 -gray -f 1 -l 1 官方GB封面.pdf /tmp/hi
 *   裁剪页首右侧标志区域（约 x 404–520pt / y 28–90pt）并二值化 —— 源本身只有 0/255 两级。
 *
 * 步骤：解析 PNG（灰度 8bit）→ 3×3 多数投票去噪 → 黑域轮廓追踪（有向边法，
 * 外轮廓顺时针/白洞逆时针自动区分）→ Douglas–Peucker 简化 → 单 path + evenodd。
 *
 * 用法：node tools/trace-gb-logo.mjs  （写 assets/gb-logo.svg）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'gb-logo.src.png');
const OUT = path.join(HERE, '..', 'assets', 'gb-logo.svg');
const EPS = 2;
const DENOISE_PASSES = 2;          // Douglas-Peucker 简化阈值（像素）
const MIN_AREA = 40;    // 丢弃小于该面积（像素²）的碎屑轮廓

/* ---------- PNG 解析（灰度 8bit，非隔行） ---------- */
function readPNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9];
      if (ctype !== 0 || depth !== 8) throw new Error('expect 8-bit grayscale, got ctype=' + ctype + ' depth=' + depth);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w;
  const img = new Uint8Array(w * h);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x > 0 ? cur[x - 1] : 0;
      const b = prev[x];
      const c = x > 0 ? prev[x - 1] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < w; x++) img[y * w + x] = cur[x] < 128 ? 1 : 0;  // 1 = 黑
    prev = cur;
  }
  return { w, h, img };
}

/* ---------- 3×3 多数投票去噪 ---------- */
function denoise(w, h, img) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && img[yy * w + xx]) n++;
        }
      }
      out[y * w + x] = n >= 5 ? 1 : 0;
  // (投票阈值 5/9)
    }
  }
  return out;
}

/* ---------- 轮廓追踪：有向边法（黑在左） ---------- */
function trace(w, h, img) {
  const at = (x, y) => (x >= 0 && x < w && y >= 0 && y < h) ? img[y * w + x] : 0;
  const edges = new Map();  // 起点 key -> [终点 key]
  const K = (x, y) => x + ',' + y;
  const add = (x1, y1, x2, y2) => {
    const k = K(x1, y1);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([x2, y2]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);        // 上边：黑在下方 → 向右
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1); // 下边 → 向左
      if (!at(x - 1, y)) add(x, y + 1, x, y);         // 左边 → 向上
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1); // 右边 → 向下
    }
  }
  const loops = [];
  for (const [k0, list] of edges) {
    while (list.length) {
      const [sx, sy] = k0.split(',').map(Number);
      const pts = [[sx, sy]];
      let cx = sx, cy = sy;
      let ck = k0;
      while (true) {
        const lst = edges.get(ck);
        if (!lst || !lst.length) break;
        const [nx, ny] = lst.shift();
        if (nx === sx && ny === sy) { cx = sx; cy = sy; break; }
        pts.push([nx, ny]);
        cx = nx; cy = ny; ck = K(cx, cy);
        if (cx === sx && cy === sy) break;
      }
      if (pts.length > 3) loops.push(pts);
    }
  }
  return loops;
}

/* ---------- 面积（鞋带公式，取绝对值） ---------- */
function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

/* ---------- Douglas–Peucker ---------- */
function dp(pts, eps) {
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let dmax = -1, idx = -1;
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    for (let i = s + 1; i < e; i++) {
      const t = ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / len2;
      const px = x1 + t * dx, py = y1 + t * dy;
      const d = Math.hypot(pts[i][0] - px, pts[i][1] - py);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const { w, h, img: raw } = readPNG(fs.readFileSync(SRC));
let img = denoise(w, h, raw);
for (let i = 1; i < DENOISE_PASSES; i++) img = denoise(w, h, img);
const loops = trace(w, h, img)
  .filter(l => area(l) >= MIN_AREA)
  .map(l => dp(l, EPS));
const d = loops.map(l =>
  'M' + l.map(([x, y]) => x + ' ' + y).join('L') + 'Z').join('');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '"><path d="' + d + '" fill="#000" fill-rule="evenodd"/></svg>\n';
fs.writeFileSync(OUT, svg);
console.log('loops=' + loops.length, 'points=' + loops.reduce((n, l) => n + l.length, 0), 'bytes=' + svg.length, '→', OUT);
