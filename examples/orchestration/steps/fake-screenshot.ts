import { deflateSync } from 'node:zlib';

/**
 * Makes a small PNG "screenshot" without a browser (the example has no UI to capture).
 * With Playwright you would write: ctx.log.image('after checkout', await page.screenshot()).
 */
export function fakeScreenshot(label: string, rgb: [number, number, number]): Uint8Array {
  const w = 240;
  const h = 90;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      const band = y < 18; // a "title bar"
      const bar = x > 20 && x < 20 + ((label.length * 13) % 200) && y > 40 && y < 60; // a "progress bar"
      raw[i] = band ? 40 : bar ? rgb[0] : 245;
      raw[i + 1] = band ? 44 : bar ? rgb[1] : 246;
      raw[i + 2] = band ? 52 : bar ? rgb[2] : 248;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
