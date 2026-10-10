// 共有メニューからの受け取り画面を、開発サーバー上で受け取り関数を直接呼んで確認する
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { makePdf } from "./fixtures.mjs";
const server = await createServer({ server: { port: 4182 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on("pageerror", (e) => console.log("pageerror", e));
const base = "http://localhost:4182/";
const share = async (name) => {
  const b64 = makePdf(name, 2).toString("base64");
  await page.evaluate(async ([name, b64]) => {
    const { receiveFiles } = await import("/src/lib/native.ts");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    receiveFiles([new File([bytes], name, { type: "application/pdf" })]);
    location.hash = "#/import";
  }, [name, b64]);
};
await page.goto(base);
await page.getByText("編み図ライブラリへようこそ").waitFor();

// 1) 新しい作品として登録
await share("Lace Shawl_日本語.pdf");
await page.getByRole("heading", { name: "受け取ったファイル" }).waitFor();
await page.screenshot({ path: (process.env.E2E_OUT ?? ".") + "/import-1.png" });
await page.getByRole("button", { name: "新しい作品として登録する" }).click();
if ((await page.getByLabel("作品タイトル（必須）").inputValue()) !== "Lace Shawl_日本語") throw new Error("title not prefilled");
await page.locator(".pending-files").getByText("Lace Shawl_日本語.pdf").waitFor();
await page.getByRole("button", { name: "この内容で登録する" }).click();
await page.locator(".detail-title", { hasText: "Lace Shawl" }).waitFor();
await page.getByText("日本語翻訳版").waitFor();
console.log("OK new pattern from shared file");

// 2) 既存の作品に追加
await share("Lace Shawl EN.pdf");
await page.getByLabel("追加先の作品を検索").fill("lace");
await page.locator(".import-targets").getByText("Lace Shawl_日本語").click();
await page.locator(".detail-title", { hasText: "Lace Shawl" }).waitFor();
await page.getByText("英語原本").waitFor();
if ((await page.locator(".file-row").count()) !== 2) throw new Error("file not added");
console.log("OK added to existing pattern");

// 3) 受け取り待ちが残っていない
await page.goto(base + "#/import");
await page.getByText("受け取ったファイルはありません").waitFor();
console.log("OK cleared");
await browser.close();
await server.close();
