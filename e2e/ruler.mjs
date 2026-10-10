// 編み図の定規（行マーカー）の確認（npm run build 後に実行）
import { chromium } from "playwright-core";
import { preview } from "vite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { makePdf } from "./fixtures.mjs";

const outDir = process.env.E2E_OUT ?? join(tmpdir(), "kpl-e2e");
mkdirSync(outDir, { recursive: true });
const pdfPath = join(outDir, "chart.pdf");
writeFileSync(pdfPath, makePdf("Chart", 2));
const server = await preview({ preview: { port: 4186, strictPort: true }, logLevel: "error" });
const base = "http://localhost:4186/";
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push(["OK", name]);
  } catch (e) {
    steps.push(["NG", name, String(e).split("\n")[0]]);
    await page.screenshot({ path: join(outDir, `ruler-fail-${steps.length}.png`) });
  }
}
const band = () => page.locator(".ruler-band");
/** 帯の位置（ページの高さに対する割合） */
const bandY = () =>
  page.evaluate(() => {
    const b = document.querySelector(".ruler-band");
    const p = b.closest(".page-box");
    const br = b.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    return { center: (br.top + br.height / 2 - pr.top) / pr.height, height: br.height / pr.height };
  });

await page.goto(base + "#/new");
await page.locator("input[type=file][multiple]").setInputFiles([pdfPath]);
await page.getByLabel("作品タイトル（必須）").fill("ケーブル模様");
await page.getByRole("button", { name: "この内容で登録する" }).click();
await page.locator(".detail-title").waitFor();
await page.getByRole("button", { name: "＋ カウンターを追加" }).click();
await page.getByLabel("カウンター名").fill("模様");
await page.getByRole("button", { name: "追加", exact: true }).click();
await page.getByRole("button", { name: /PDFを見る/ }).click();
await page.waitForFunction(() => (document.querySelector('.page-box[data-page="1"] canvas')?.width ?? 0) > 0);

let start;
await step("定規を出すと、帯と操作ボタンが表示される", async () => {
  await page.getByRole("button", { name: "定規" }).click();
  await band().waitFor();
  await page.getByRole("button", { name: "↑ 次の段" }).waitFor();
  start = await bandY();
  await page.screenshot({ path: join(outDir, "ruler-01.png") });
});

await step("「次の段」で帯の太さぶん上へ、「前の段」で下へ動く", async () => {
  await page.getByRole("button", { name: "↑ 次の段" }).click();
  const a = await bandY();
  if (Math.abs(start.center - a.center - start.height) > 0.005) throw new Error(`上に動いていない ${start.center} → ${a.center}`);
  await page.getByRole("button", { name: "↓ 前の段" }).click();
  const b = await bandY();
  if (Math.abs(b.center - start.center) > 0.005) throw new Error("元の位置に戻らない");
});

await step("太さを変えられる", async () => {
  await page.getByRole("button", { name: "帯を太くする" }).click();
  const a = await bandY();
  if (!(a.height > start.height * 1.1)) throw new Error("太くなっていない");
  await page.getByRole("button", { name: "帯を細くする" }).click();
});

await step("ドラッグで動かせる", async () => {
  const before = await bandY();
  const box = await band().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 6 });
  await page.mouse.up();
  const after = await bandY();
  if (!(after.center > before.center + 0.03)) throw new Error("ドラッグで動いていない");
});

await step("段数カウンターと連動すると、＋で1段進む", async () => {
  await page.getByLabel("連動する段数カウンター").selectOption({ label: "模様と連動" });
  const before = await bandY();
  await page.getByRole("button", { name: "段数" }).click();
  await page.getByRole("button", { name: "模様 を1段進める" }).click();
  await page.waitForTimeout(300);
  const after = await bandY();
  if (Math.abs(before.center - after.center - before.height) > 0.005) throw new Error(`連動していない ${before.center} → ${after.center}`);
  await page.screenshot({ path: join(outDir, "ruler-02-linked.png") });
  await page.getByRole("button", { name: "段数" }).click();
});

await step("開き直しても同じ位置に表示される", async () => {
  const before = await bandY();
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => (document.querySelector('.page-box[data-page="1"] canvas')?.width ?? 0) > 0);
  await band().waitFor();
  const after = await bandY();
  if (Math.abs(before.center - after.center) > 0.005) throw new Error("位置が保存されていない");
});

await step("書き込み中は帯を動かさず、線を引ける", async () => {
  await page.getByRole("button", { name: "書込" }).click();
  if (await page.locator(".ruler-band.draggable").count()) throw new Error("書き込み中も帯を動かせてしまう");
  if (await page.locator(".ruler-toolbar").count()) throw new Error("書き込み中に定規のボタンが出ている");
  await page.getByRole("button", { name: "書込" }).click();
});

await step("定規を消せる", async () => {
  await page.getByRole("button", { name: "定規" }).click();
  if (await band().count()) throw new Error("消えていない");
});

for (const s of steps) console.log(s.join("  "));
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(steps.some((s) => s[0] === "NG") || errors.length ? 1 : 0);
