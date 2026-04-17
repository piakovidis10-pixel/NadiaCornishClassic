// Generates Cornish flag (St Piran) PNG icons for the PWA home screen.
// Run once: node generate-icons.js
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 (required by PNG format) ───────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([len, type, data, crcBuf]);
}

// ── Cornish flag pixel generator ─────────────────────────────────────────────
function cornishFlagPNG(size) {
  const armW  = Math.round(size * 0.22);   // cross arm width ~22% of size
  const half  = Math.round(armW / 2);
  const cx    = Math.round(size / 2);
  const cy    = Math.round(size / 2);

  // Raw scanlines: 1 filter byte + 3 bytes (RGB) per pixel
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const white = (Math.abs(y - cy) < half) || (Math.abs(x - cx) < half);
      const off   = y * (size * 3 + 1) + 1 + x * 3;
      raw[off] = raw[off + 1] = raw[off + 2] = white ? 255 : 0;
    }
  }

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; // 8-bit RGB

  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = chunk(Buffer.from('IHDR'), ihdrData);
  const idat = chunk(Buffer.from('IDAT'), zlib.deflateSync(raw, { level: 9 }));
  const iend = chunk(Buffer.from('IEND'), Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ── Write icons ───────────────────────────────────────────────────────────────
const out = path.join(__dirname, 'public');
[180, 192, 512].forEach(size => {
  const file = path.join(out, `icon-${size}.png`);
  fs.writeFileSync(file, cornishFlagPNG(size));
  console.log(`wrote ${file}`);
});
