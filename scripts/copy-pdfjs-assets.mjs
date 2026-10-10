// pdf.js が日本語フォント等の表示に使う CMap / 標準フォント / wasm を public/ にコピーする。
// オフラインでも描画できるよう、外部 CDN ではなくアプリ内に同梱する。
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

if (!existsSync(src)) {
  console.error("pdfjs-dist が見つかりません。npm install を実行してください。");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  if (existsSync(join(src, dir))) cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log("pdf.js assets copied to public/pdfjs");
