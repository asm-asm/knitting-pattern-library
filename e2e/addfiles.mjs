// 登録済みの作品にあとから PDF を追加する確認（npm run build 後に実行）
// 例：英語原本で登録した作品に、日本語化した PDF を追加して2つにする。
import { chromium } from "playwright-core";
import { preview } from "vite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { makePdf } from "./fixtures.mjs";

const outDir = process.env.E2E_OUT ?? join(tmpdir(), "kpl-e2e");
mkdirSync(outDir, { recursive: true });
const enPdf = join(outDir, "Mohair Beret.pdf");
const jaPdf = join(outDir, "Mohair Beret (1).pdf"); // ファイル名から種類が分からない日本語化 PDF
writeFileSync(enPdf, makePdf("Mohair Beret", 2));
writeFileSync(jaPdf, makePdf("Mohair Beret JA", 3));
const server = await preview({ preview: { port: 4188, strictPort: true }, logLevel: "error" });
const base = "http://localhost:4188/";
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
    await page.screenshot({ path: join(outDir, `addfiles-fail-${steps.length}.png`) });
  }
}

await page.goto(base + "#/new");
await page.locator("input[type=file][multiple]").setInputFiles([enPdf]);
await page.getByLabel("作品タイトル（必須）").fill("モヘアのベレー帽");
await page.getByRole("button", { name: "この内容で登録する" }).click();
await page.locator(".detail-title", { hasText: "モヘアのベレー帽" }).waitFor();

await step("詳細画面でPDFを選ぶだけで保存され、2件目は日本語翻訳版になる", async () => {
  await page.getByLabel("追加するファイル").setInputFiles([jaPdf]);
  await page.locator(".toast", { hasText: "「日本語翻訳版」として追加しました" }).waitFor();
  await page.getByRole("link", { name: /Mohair Beret \(1\)\.pdf/ }).waitFor();
  await page.screenshot({ path: join(outDir, "addfiles-01-detail.png"), fullPage: true });
});

await step("再読み込みしても2件とも残っている", async () => {
  await page.reload();
  await page.locator(".detail-title", { hasText: "モヘアのベレー帽" }).waitFor();
  await page.getByText("英語原本").waitFor();
  await page.getByText("日本語翻訳版").waitFor();
  await page.getByRole("link", { name: /Mohair Beret\.pdf/ }).waitFor();
  await page.getByRole("link", { name: /Mohair Beret \(1\)\.pdf/ }).waitFor();
});

await step("2件目のPDFをビューアで開け、ファイルを切り替えられる", async () => {
  await page.getByRole("link", { name: /Mohair Beret \(1\)\.pdf/ }).click();
  await page.waitForFunction(() => (document.querySelector('.page-box[data-page="3"]') ?? null) !== null);
  const select = page.getByLabel("表示するファイル");
  const n = await select.locator("option").count();
  if (n !== 2) throw new Error(`ファイル切替の選択肢が${n}件`);
});

for (const s of steps) console.log(s.join("  "));
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(steps.some((s) => s[0] === "NG") || errors.length ? 1 : 0);
