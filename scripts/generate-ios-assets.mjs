// iOS のアプリアイコン（1024×1024）と起動画面（2732×2732）を public/icon.svg のデザインから生成する。
//   node scripts/generate-ios-assets.mjs
// App Store のアイコンは透過（アルファチャンネル）不可のため、RGB の PNG に変換して保存する。
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const BG = "#f7f3ee";
// 角丸なし・全面塗りのアイコン（角丸は iOS が付ける）
const iconSvg = readFileSync("public/icon.svg", "utf8").replace('rx="112"', 'rx="0"');

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
async function render(size, inner) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:${BG}">${inner}</body></html>`);
  const png = await page.screenshot({ type: "png" });
  await page.close();
  return toRgbPng(png);
}

const icon = await render(1024, iconSvg.replace("<svg ", '<svg width="1024" height="1024" '));
const splashSize = 2732;
const splash = await render(
  splashSize,
  `<div style="width:${splashSize}px;height:${splashSize}px;display:flex;align-items:center;justify-content:center">${iconSvg.replace("<svg ", '<svg width="560" height="560" ')}</div>`,
);
await browser.close();

const iconDir = "ios/App/App/Assets.xcassets/AppIcon.appiconset";
const splashDir = "ios/App/App/Assets.xcassets/Splash.imageset";
writeFileSync(`${iconDir}/AppIcon-512@2x.png`, icon);
for (const n of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) writeFileSync(`${splashDir}/${n}`, splash);
writeFileSync("resources/icon-1024.png", icon);
console.log("generated icon and splash");

// ---- PNG（RGBA 8bit）を RGB に変換する最小実装 ----
function toRgbPng(buf) {
  const chunks = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    chunks.push({ type: buf.toString("ascii", pos + 4, pos + 8), data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === "IHDR").data;
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const [depth, colorType] = [ihdr[8], ihdr[9]];
  if (depth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`unsupported png ${depth}/${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  const out = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    out[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) px.copy(out, y * (w * 3 + 1) + 1 + x * 3, y * stride + x * bpp, y * stride + x * bpp + 3);
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "ascii");
    data.copy(b, 8);
    b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return b;
  };
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(w, 0);
  hdr.writeUInt32BE(h, 4);
  hdr[8] = 8;
  hdr[9] = 2; // RGB
  return Buffer.concat([buf.subarray(0, 8), chunk("IHDR", hdr), chunk("IDAT", deflateSync(out, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(b) {
  let c = ~0;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
