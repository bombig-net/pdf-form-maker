// Renders the app icon ("magic fold") to PNG without dependencies (needed for iOS home screen and the web manifest).
// The SVG in index.html and src/theme.css uses the same geometry on a 64 × 64 grid.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'public';
mkdirSync(out, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const roundRect = (x, y, w, h, r) => (px, py) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};
const polygon = (pts) => (px, py) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Shapes from back to front; `full` = square without rounded corners (iOS rounds the icon itself). */
const shapes = (full) => [
  [full ? () => true : roundRect(0, 0, 64, 64, 14), hex('#121212')],
  [polygon([[18, 12], [37, 12], [48, 23], [48, 52], [18, 52]]), hex('#262626')],
  [polygon([[37, 12], [37, 23], [48, 23]]), hex('#3ecf8e')],
  [roundRect(23, 30, 20, 7, 2), hex('#3ecf8e')],
  [roundRect(23, 41, 13, 4, 2), hex('#3a3a3a')],
];

function render(size, full) {
  const s = shapes(full), N = 4, px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const u = ((x + (sx + 0.5) / N) / size) * 64, v = ((y + (sy + 0.5) / N) / size) * 64;
      let c = null;
      for (const [hit, col] of s) if (hit(u, v)) c = col;
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const i = (y * size + x) * 4, n = N * N;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
    px[i + 3] = Math.round((a / n) * 255);
  }
  return png(size, px);
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(`${out}/apple-touch-icon.png`, render(180, true));
writeFileSync(`${out}/icon-192.png`, render(192, false));
writeFileSync(`${out}/icon-512.png`, render(512, false));
