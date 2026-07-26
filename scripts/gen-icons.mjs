/**
 * PWA アイコンと favicon を生成する。
 *
 * 図形は単位正方形上の定数として 1 か所に定義し、SVG と PNG の両方をそこから出す。
 * 2 つの表現を別々に手で書くと必ずずれるため。
 * 色は global.css と同じ oklch 値から変換する。ブランド色の情報源を 1 つに保つ。
 *
 * ビルド成果物なので node: の import を使ってよい（AGENTS.md §5 の禁止はランタイム側の話）。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public');

/** global.css の :root と同じ値 */
const COLOR = {
  primary: [0.52, 0.11, 220],
  primaryForeground: [0.99, 0.005, 220],
};

/** 単位正方形（0..1）上での ♨ の形。左上原点 */
const SHAPE = {
  bowl: { cx: 0.5, cy: 0.605, rx: 0.335, ry: 0.21 },
  steamHalfWidth: 0.031,
  steamAmplitude: 0.05,
  steams: [
    { cx: 0.315, bottom: 0.5, top: 0.26 },
    { cx: 0.5, bottom: 0.5, top: 0.175 },
    { cx: 0.685, bottom: 0.5, top: 0.26 },
  ],
};

/** 角丸の半径（辺の長さに対する比） */
const CORNER = 0.2;

function oklchToRgb([l, c, hDeg]) {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const lm = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sm = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * lm - 3.3077115913 * mm + 0.2309699292 * sm,
    -1.2684380046 * lm + 2.6097574011 * mm - 0.3413193965 * sm,
    -0.0041960863 * lm - 0.7034186147 * mm + 1.707614701 * sm,
  ];

  return linear.map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** 蒸気の中心線。t=0 が下端、t=1 が上端 */
function steamPoint(steam, t) {
  return {
    x: steam.cx + SHAPE.steamAmplitude * Math.sin(2 * Math.PI * t),
    y: steam.bottom + (steam.top - steam.bottom) * t,
  };
}

/** 図形の内側かどうか。座標は単位正方形上 */
function inShape(x, y) {
  const { bowl } = SHAPE;
  const dx = (x - bowl.cx) / bowl.rx;
  const dy = (y - bowl.cy) / bowl.ry;
  if (y >= bowl.cy && dx * dx + dy * dy <= 1) return true;

  const r2 = SHAPE.steamHalfWidth ** 2;
  for (const steam of SHAPE.steams) {
    // 中心線を細かく分割し、線分ではなく点との距離で近似する。
    // 分割数が十分なら丸キャップの連なりと同じ結果になる
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const p = steamPoint(steam, i / steps);
      const ex = x - p.x;
      const ey = y - p.y;
      if (ex * ex + ey * ey <= r2) return true;
    }
  }
  return false;
}

/** 角丸の外側かどうか。full bleed のときは常に false */
function outsideCorner(x, y, rounded) {
  if (!rounded) return false;
  const r = CORNER;
  const cx = x < r ? r : x > 1 - r ? 1 - r : x;
  const cy = y < r ? r : y > 1 - r ? 1 - r : y;
  if (cx === x && cy === y) return false;
  return (x - cx) ** 2 + (y - cy) ** 2 > r * r;
}

const SUPERSAMPLE = 4;

/**
 * @param {number} size 出力サイズ（px）
 * @param {{ rounded: boolean, scale: number, opaque: boolean }} options
 */
function renderPng(size, options) {
  const bg = oklchToRgb(COLOR.primary);
  const fg = oklchToRgb(COLOR.primaryForeground);
  const ss = SUPERSAMPLE;
  const raw = Buffer.alloc(size * (size * 4 + 1));

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // フィルタなし
    for (let x = 0; x < size; x++) {
      let inside = 0;
      let covered = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          if (outsideCorner(u, v, options.rounded)) continue;
          covered++;
          // 図形だけを scale 倍して中央に置く。背景は縮めない
          const su = (u - 0.5) / options.scale + 0.5;
          const sv = (v - 0.5) / options.scale + 0.5;
          if (inShape(su, sv)) inside++;
        }
      }

      const total = ss * ss;
      const alpha = options.opaque ? 1 : covered / total;
      const mix = covered === 0 ? 0 : inside / covered;
      const p = rowStart + 1 + x * 4;
      for (let ch = 0; ch < 3; ch++) {
        raw[p + ch] = Math.round(bg[ch] * (1 - mix) + fg[ch] * mix);
      }
      raw[p + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderSvg() {
  const bg = hex(oklchToRgb(COLOR.primary));
  const fg = hex(oklchToRgb(COLOR.primaryForeground));
  const { bowl } = SHAPE;
  const n = (v) => Number(v.toFixed(4));

  const bowlPath =
    `M${n(bowl.cx - bowl.rx)} ${n(bowl.cy)}` +
    `a${n(bowl.rx)} ${n(bowl.ry)} 0 0 0 ${n(bowl.rx * 2)} 0z`;

  const steamPaths = SHAPE.steams
    .map((steam) => {
      const points = Array.from({ length: 25 }, (_, i) => {
        const p = steamPoint(steam, i / 24);
        return `${n(p.x)} ${n(p.y)}`;
      });
      return (
        `<path d="M${points.join('L')}" fill="none" stroke="${fg}"` +
        ` stroke-width="${n(SHAPE.steamHalfWidth * 2)}" stroke-linecap="round"/>`
      );
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" role="img" aria-label="水無海浜温泉">` +
    `<rect width="1" height="1" rx="${CORNER}" fill="${bg}"/>` +
    `<path d="${bowlPath}" fill="${fg}"/>` +
    steamPaths +
    `</svg>\n`
  );
}

const TARGETS = [
  ['icon-192.png', 192, { rounded: true, scale: 1, opaque: false }],
  ['icon-512.png', 512, { rounded: true, scale: 1, opaque: false }],
  // マスカブルは端が切られる。安全領域（中央 80%）に収まるよう縮める
  ['icon-maskable-192.png', 192, { rounded: false, scale: 0.7, opaque: true }],
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.7, opaque: true }],
  // iOS は自前で角を丸める。透明部分があると黒く塗られるので不透明の正方形にする
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.82, opaque: true }],
  ['favicon-32.png', 32, { rounded: true, scale: 1, opaque: false }],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, options] of TARGETS) {
  writeFileSync(join(OUT_DIR, name), renderPng(size, options));
  console.log(`${name} (${String(size)}x${String(size)})`);
}
writeFileSync(join(OUT_DIR, 'favicon.svg'), renderSvg());
console.log('favicon.svg');
console.log(`primary=${hex(oklchToRgb(COLOR.primary))}`);
