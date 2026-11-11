'use strict';
// Generates assets/icon.png (32x32): a gold chevron on a dark rounded square. No dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 32;
const px = Buffer.alloc(S * S * 4);
function set(x, y, r, g, b, a) {
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = Math.min(x, S - 1 - x), cy = Math.min(y, S - 1 - y);
    const corner = cx < 5 && cy < 5 && Math.hypot(5 - cx, 5 - cy) > 5.5;
    if (corner) { set(x, y, 0, 0, 0, 0); continue; }
    set(x, y, 24, 20, 16, 255);
    // chevron pointing right: two thick diagonal strokes
    const dx = x - 9, dy = y - 16;
    const d = Math.abs(Math.abs(dy) - (12 - dx));
    if (dx >= 0 && dx <= 12 && Math.abs(dy) <= 12 && d <= 2.6) set(x, y, 230, 180, 80, 255);
  }
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
