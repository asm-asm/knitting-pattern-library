// PDF 内のリンクと印刷の確認（npm run build 後に実行）
import { chromium } from "playwright-core";
import { preview } from "vite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { makeLinkedPdf } from "./fixtures.mjs";

const outDir = process.env.E2E_OUT ?? join(tmpdir(), "kpl-e2e");
mkdirSync(outDir, { recursive: true });
const pdfPath = join(outDir, "Linked Pattern.pdf");
writeFileSync(pdfPath, makeLinkedPdf());
const server = await preview({ preview: { port: 4189, strictPort: true }, logLevel: "error" });
const base = "http://localhost:4189/";
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// 印刷画面は開かず、印刷が呼ばれた回数だけ数える（iframe 内の print も含む）
await context.addInitScript(() => {
  window.print = () => {
    window.top.__printed = (window.top.__printed ?? 0) + 1;
  };
});
const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push(["OK", name]);
  } catch (e) {
    steps.push(["NG", name, String(e).split("\n")[0]]);
    await page.screenshot({ path: join(outDir, `links-fail-${steps.length}.png`) });
  }
}
const pageSelect = () => page.getByLabel("ページ移動");
const canvasReady = (n) => page.waitForFunction((n) => (document.querySelector(`.page-box[data-page="${n}"] canvas`)?.width ?? 0) > 0, n);
const printed = () => page.evaluate(() => window.__printed ?? 0);
const printFrame = () => page.locator("#print-frame");

await page.goto(base + "#/new");
await page.locator("input[type=file][multiple]").setInputFiles([pdfPath]);
await page.getByLabel("作品タイトル（必須）").fill("リンク付きの編み図");
await page.getByRole("button", { name: "この内容で登録する" }).click();
await page.locator(".detail-title", { hasText: "リンク付きの編み図" }).waitFor();

await step("目次のリンクを押すと、リンク先のページへ移動する", async () => {
  await page.getByRole("link", { name: /Linked Pattern\.pdf/ }).click();
  await canvasReady(1);
  const links = page.locator('.page-box[data-page="1"] .pdf-link');
  await links.nth(1).waitFor();
  if ((await links.count()) !== 2) throw new Error(`リンクが${await links.count()}件`);
  await page.screenshot({ path: join(outDir, "links-01-viewer.png") });
  await page.getByRole("button", { name: "ページ内リンク" }).click();
  await page.waitForFunction(() => document.querySelector(".page-select")?.value === "2");
});

await step("外部リンクは確認してからブラウザで開く", async () => {
  await pageSelect().selectOption("0");
  await canvasReady(1);
  await page.getByRole("button", { name: "リンク：https://example.com/errata" }).click();
  await page.getByRole("alertdialog").getByText("example.com").waitFor();
  const popup = page.waitForEvent("popup", { timeout: 5000 });
  await page.getByRole("button", { name: "開く" }).click();
  const p = await popup;
  if (!p.url().startsWith("https://example.com/errata")) throw new Error("開いた URL が違う: " + p.url());
  await p.close();
});

await step("書き込みモード中はリンクが反応しない（線を引ける）", async () => {
  await page.getByRole("button", { name: "書込" }).click();
  if ((await page.locator(".pdf-link").count()) !== 0) throw new Error("書き込みモードでリンクが残っている");
  const layer = page.locator('.page-box[data-page="1"] .annot-layer');
  const box = await layer.boundingBox();
  const y = box.height * 0.08; // 目次リンクの上に線を引く
  await page.mouse.move(box.x + box.width * 0.15, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + y, { steps: 10 });
  await page.mouse.up();
  await layer.locator("svg path").first().waitFor({ state: "attached" });
  if ((await pageSelect().inputValue()) !== "0") throw new Error("線を引いたらページが移動した");
  await page.getByRole("button", { name: "書込" }).click();
});

await step("印刷：書き込みがあれば選べる。キャンセルでは印刷しない", async () => {
  await page.getByRole("button", { name: "Linked Pattern.pdf を印刷" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByText("書き込みも一緒に印刷しますか").waitFor();
  await page.screenshot({ path: join(outDir, "links-02-print-choice.png") });
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await page.waitForTimeout(300);
  if ((await printed()) !== 0) throw new Error("キャンセルしたのに印刷した");
});

await step("印刷：書き込みも印刷すると、ページごとの画像を印刷する", async () => {
  await page.getByRole("button", { name: "Linked Pattern.pdf を印刷" }).click();
  await page.getByRole("button", { name: "書き込みも印刷" }).click();
  await page.waitForFunction(() => (window.__printed ?? 0) === 1, null, { timeout: 30000 });
  const n = await printFrame().evaluate((f) => f.contentDocument.images.length);
  if (n !== 3) throw new Error(`印刷する画像が${n}枚`);
  // 1ページ目の画像にマーカー（黄色）が描かれている
  const hasMarker = await printFrame().evaluate(async (f) => {
    const img = f.contentDocument.images[0];
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const y = Math.round(c.height * 0.08);
    const d = ctx.getImageData(Math.round(c.width * 0.3), y - 3, 1, 7).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 180 && d[i + 2] < 160) return true;
    return false;
  });
  if (!hasMarker) throw new Error("印刷用の画像にマーカーが描かれていない");
});

await step("印刷：元のPDFのまま印刷すると、PDFをそのまま渡す（作品詳細から）", async () => {
  await page.getByRole("button", { name: "作品詳細に戻る" }).click();
  await page.locator(".detail-title", { hasText: "リンク付きの編み図" }).waitFor();
  await page.locator(".file-row").first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.screenshot({ path: join(outDir, "links-03-detail.png") });
  await page.getByRole("button", { name: "Linked Pattern.pdf を印刷" }).click();
  await page.getByRole("button", { name: "元のPDFのまま" }).click();
  await page.waitForFunction(() => document.getElementById("print-frame")?.src?.startsWith("blob:"), null, { timeout: 15000 });
});

for (const s of steps) console.log(s.join("  "));
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(steps.some((s) => s[0] === "NG") || errors.length ? 1 : 0);
