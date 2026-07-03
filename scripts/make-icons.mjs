// Generates the PWA app icons as plain PNGs with zero dependencies (just
// Node's built-in zlib) — a black square with a luminous "blip" mark, in the
// same visual language as the display itself. Run: npm run make-icons
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw scanlines, each prefixed with filter-type byte 0 (none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** Simple radial "blip" mark on black, matching the display's aircraft glyph glow. */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const coreR = size * 0.07;
  const glowR = size * 0.34;
  // Faint range ring, like the display's compass rings.
  const ringR = size * 0.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      let r = 0, g = 0, b = 0, a = 255;
      // Ring (thin, faint blue-grey).
      if (Math.abs(d - ringR) < size * 0.006) {
        r = 58; g = 66; b = 86; a = 255;
      }
      if (d < glowR) {
        const t = 1 - d / glowR;
        // Soft periwinkle glow.
        r = Math.round(20 + 130 * t * t);
        g = Math.round(24 + 130 * t * t);
        b = Math.round(40 + 200 * t * t);
      }
      if (d < coreR) {
        const t = 1 - d / coreR;
        r = Math.round(200 + 55 * t);
        g = Math.round(210 + 45 * t);
        b = 255;
      }
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

for (const size of [192, 512]) {
  const png = encodePng(size, size, drawIcon(size));
  const path = join(outDir, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`wrote ${path}`);
}
