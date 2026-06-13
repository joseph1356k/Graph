// Generates the PWA PNG icons (no dependencies) so iOS/Android have proper raster
// icons. Draws a medical "+" in the brand blue on a dark square; iOS rounds the
// corners itself. Run: node scripts/make-icons.js
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size) {
  const bg = [0x10, 0x18, 0x20]; // #101820
  const fg = [0x2f, 0x8c, 0xff]; // #2f8cff
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  const barW = Math.round(size * 0.16);
  const barLen = Math.round(size * 0.52);
  const c0 = (size - barW) / 2, c1 = (size + barW) / 2;
  const l0 = (size - barLen) / 2, l1 = (size + barLen) / 2;
  for (let y = 0; y < size; y++) {
    let off = y * (stride + 1);
    raw[off++] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      const vert = (x >= c0 && x < c1 && y >= l0 && y < l1);
      const horiz = (y >= c0 && y < c1 && x >= l0 && x < l1);
      const col = (vert || horiz) ? fg : bg;
      raw[off++] = col[0];
      raw[off++] = col[1];
      raw[off++] = col[2];
      raw[off++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(process.cwd(), 'web', 'public');
fs.writeFileSync(path.join(out, 'icon-192.png'), makePng(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), makePng(512));
console.log('Wrote web/public/icon-192.png and web/public/icon-512.png');
