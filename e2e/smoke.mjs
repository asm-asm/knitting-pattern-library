// ブラウザでの動作確認（npm run build 後に実行）。
//   node e2e/smoke.mjs
// Windows では Microsoft Edge を、それ以外では BROWSER_PATH で指定したブラウザを使う。
import { chromium } from "playwright-core";
import { preview } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makePdf } from "./fixtures.mjs";

const outDir = process.env.E2E_OUT ?? join(tmpdir(), "kpl-e2e");
mkdirSync(outDir, { recursive: true });
const enPdf = join(outDir, "Cable Sweater.pdf");
const jaPdf = join(outDir, "ケーブルセーター_日本語.pdf");
const brokenPdf = join(outDir, "broken.pdf");
writeFileSync(enPdf, makePdf("Cable Sweater EN", 5));
writeFileSync(jaPdf, makePdf("Japanese version", 7));
writeFileSync(brokenPdf, "this is not a pdf");

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: "error" });
const base = "http://localhost:4179/";

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push(["OK", name]);
  } catch (e) {
    steps.push(["NG", name, String(e).split("\n")[0]]);
    await page.screenshot({ path: join(outDir, `fail-${steps.length}.png`) });
  }
}
const shot = (n) => page.screenshot({ path: join(outDir, `${n}.png`), fullPage: true });

await page.goto(base);
await step("ホーム（初回）表示", async () => {
  await page.getByText("編み図ライブラリへようこそ").waitFor();
  await shot("01-home-empty");
});

await step("PDF 2件（原本+日本語版）で作品登録", async () => {
  await page.getByRole("link", { name: /登録/ }).first().click();
  await page.locator('input[type=file][multiple]').setInputFiles([enPdf, jaPdf]);
  await page.getByLabel("作品タイトル（必須）").fill("ケーブル編みのセーター");
  await page.getByLabel("購入先URL").fill("https://www.ravelry.com/patterns/library/cable-sweater");
  await page.getByLabel("購入先URL").blur();
  await page.getByRole("radio", { name: "制作中" }).click();
  await page.getByRole("button", { name: "セーター", exact: true }).click();
  await page.getByPlaceholder("例：ラグラン、モヘア").fill("ケーブル");
  await page.keyboard.press("Enter");
  await shot("02-new-form");
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await page.locator(".detail-title", { hasText: "ケーブル編みのセーター" }).waitFor();
  await page.getByText("英語原本").waitFor();
  await page.getByText("日本語翻訳版").waitFor();
  await page.getByText("7ページ").waitFor();
  await page.locator(".detail-cover").and(page.locator("img")).waitFor(); // PDF 1ページ目から表紙を生成
  await page.getByText("ravelry.com", { exact: true }).waitFor();
  await shot("03-detail");
});

await step("壊れたPDFはエラー表示され登録されない", async () => {
  await page.goto(base + "#/new");
  await page.reload();
  await page.locator('input[type=file][multiple]').setInputFiles([brokenPdf]);
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await page.locator(".toast-error", { hasText: "PDFとして読み込めません" }).waitFor();
});

await step("URLのみで登録（タイトル候補）", async () => {
  await page.goto(base + "#/new");
  await page.reload();
  await page.getByLabel("購入先URL").fill("https://example.com/shop/mohair-beret");
  await page.getByRole("button", { name: "タイトルに「mohair beret」を使う" }).click();
  await page.getByRole("radio", { name: "編みたい" }).click();
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await page.locator(".detail-title", { hasText: "mohair beret" }).waitFor();
});

await step("ライブラリ：グリッド/リスト切替・検索・絞り込み", async () => {
  await page.goto(base + "#/library");
  await page.locator(".grid .card").nth(1).waitFor();
  await shot("04-library-grid");
  await page.getByRole("button", { name: "リスト" }).click();
  await page.locator(".list .row").nth(1).waitFor();
  await shot("05-library-list");
  await page.getByLabel("作品を検索").fill("けーぶる");
  await page.locator(".list .row").first().waitFor();
  if ((await page.locator(".list .row").count()) !== 1) throw new Error("検索結果が1件ではない");
  await page.getByLabel("作品を検索").fill("");
  await page.getByRole("button", { name: /絞り込み/ }).click();
  await page.locator(".filters").getByRole("combobox").first().selectOption("no");
  await page.getByText("1件").waitFor();
  await page.getByText("mohair beret").waitFor();
  await page.getByRole("button", { name: "絞り込みを解除" }).click();
});

await step("再読み込み後もデータと表示形式が保持される", async () => {
  await page.reload();
  await page.locator(".list .row").nth(1).waitFor();
});

await step("ホームに制作中の作品が表示される", async () => {
  await page.goto(base);
  await page.locator(".wip-card", { hasText: "ケーブル編みのセーター" }).waitFor();
  await shot("06-home");
});

await step("オフラインでも起動・閲覧・編集できる", async () => {
  // Service Worker の準備完了を待ってからオフラインにする
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.getByText("オフラインです").waitFor();
  await page.locator(".wip-card").first().click();
  await page.getByRole("radio", { name: "一時中断" }).click();
  await page.getByRole("radio", { name: "一時中断", checked: true }).waitFor();
  await shot("07-offline-detail");
  await context.setOffline(false);
});

await step("作品の削除（確認あり）", async () => {
  await page.goto(base + "#/library");
  await page.getByText("mohair beret").click();
  await page.getByRole("button", { name: "この作品を削除" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "削除する" }).click();
  await page.locator(".page.library").waitFor();
  if (await page.getByText("mohair beret").count()) throw new Error("削除されていない");
  await page.locator(".list .row", { hasText: "ケーブル" }).waitFor();
});

for (const s of steps) console.log(s.join("  "));
const relevantErrors = errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e));
if (relevantErrors.length) console.log("console errors:\n" + relevantErrors.join("\n"));
console.log("screenshots:", outDir);
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(steps.some((s) => s[0] === "NG") || relevantErrors.length ? 1 : 0);
