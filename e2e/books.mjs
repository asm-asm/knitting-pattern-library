// 本・電子書籍の登録と、作品との結び付きの確認（npm run build 後に実行）
// 本の情報の取得（openBD）はテスト用の応答に置き換えて、通信に依存しないようにする。
import { chromium } from "playwright-core";
import { preview } from "vite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";

const outDir = process.env.E2E_OUT ?? join(tmpdir(), "kpl-e2e");
mkdirSync(outDir, { recursive: true });
const server = await preview({ preview: { port: 4185, strictPort: true }, logLevel: "error" });
const base = "http://localhost:4185/";
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("https://api.openbd.jp/**", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ summary: { title: "はじめての北欧ニット", volume: "", author: "山田,花子,1970-", publisher: "手芸出版社", cover: "" } }]),
  }),
);

const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push(["OK", name]);
  } catch (e) {
    steps.push(["NG", name, String(e).split("\n")[0]]);
    await page.screenshot({ path: join(outDir, `books-fail-${steps.length}.png`) });
  }
}
const shot = (n) => page.screenshot({ path: join(outDir, `${n}.png`), fullPage: true });

await page.goto(base);
await page.getByText("編み図ライブラリへようこそ").waitFor();

await step("ISBN から本の情報を読み込んで、本を登録できる", async () => {
  await page.goto(base + "#/new");
  await page.getByRole("tab", { name: "本", exact: true }).click();
  await page.getByLabel("ISBN（本の裏の13桁の番号）").fill("0-306-40615-2");
  await page.getByRole("button", { name: "読み込む" }).click();
  await page.locator(".toast", { hasText: "本の情報を読み込みました" }).waitFor();
  if ((await page.getByLabel("書名（必須）").inputValue()) !== "はじめての北欧ニット") throw new Error("書名が入っていない");
  if ((await page.getByLabel("著者").inputValue()) !== "山田花子") throw new Error("著者が入っていない");
  if ((await page.getByLabel("ISBN（本の裏の13桁の番号）").inputValue()) !== "978-0306406157") throw new Error("ISBN が13桁になっていない");
  await shot("books-01-new");
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await page.locator(".detail-title", { hasText: "はじめての北欧ニット" }).waitFor();
  await page.getByText("著者：山田花子").waitFor();
  await page.getByText("978-0306406157").waitFor();
  if (await page.getByText("制作ステータス").count()) throw new Error("本に制作ステータスが出ている");
  if (await page.getByText("段数カウンター").count()) throw new Error("本に段数カウンターが出ている");
});

await step("本の画面から、その本の作品を登録して結び付けられる", async () => {
  await page.getByRole("link", { name: "＋ この本の作品を登録" }).click();
  if ((await page.getByLabel("掲載している本（任意）").inputValue()) === "") throw new Error("本が選ばれていない");
  await page.getByLabel("作品タイトル（必須）").fill("北欧柄のミトン");
  await page.getByLabel("掲載ページ").fill("24");
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await page.locator(".detail-title", { hasText: "北欧柄のミトン" }).waitFor();
  await page.getByText("24ページ").waitFor();
  await shot("books-02-pattern");
  await page.getByRole("link", { name: "『はじめての北欧ニット』" }).click();
  await page.locator(".book-patterns").getByText("北欧柄のミトン").waitFor();
  await shot("books-03-book-detail");
});

await step("電子書籍を登録すると「電子書籍を開く」が出る", async () => {
  await page.goto(base + "#/new?type=ebook");
  await page.reload();
  await page.getByRole("tab", { name: "電子書籍", selected: true }).waitFor();
  // 電子書籍では URL の欄が一番上に来る
  const firstLabel = await page.locator(".form-section .field label").first().textContent();
  if (firstLabel !== "電子書籍のURL") throw new Error("一番上が電子書籍のURLではない: " + firstLabel);
  if (await page.getByLabel("購入先URL").count()) throw new Error("電子書籍に購入先URL欄が出ている");
  await page.getByLabel("電子書籍のURL").fill("https://example.com/ebook/123");
  await page.getByLabel("書名（必須）").fill("かぎ針の電子書籍");
  await page.screenshot({ path: join(outDir, "books-05-ebook-new.png") });
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await page.getByRole("button", { name: /電子書籍を開く/ }).waitFor();
});

await step("ホームに「持っている本」「電子書籍」の棚が出る", async () => {
  await page.goto(base);
  await page.locator(".section", { hasText: "持っている本" }).getByText("はじめての北欧ニット").waitFor();
  await page.locator(".section", { hasText: "電子書籍" }).last().getByText("かぎ針の電子書籍").waitFor();
  // 作品の数には本を含めない
  if ((await page.locator(".stat").first().locator(".stat-num").textContent()) !== "1") throw new Error("作品数に本が含まれている");
  await shot("books-04-home");
});

await step("ライブラリで種類ごとに絞り込める", async () => {
  await page.goto(base + "#/library");
  await page.getByRole("tab", { name: "本", exact: true }).click();
  await page.getByText("1件").waitFor();
  await page.getByText("はじめての北欧ニット").waitFor();
  await page.getByRole("tab", { name: "すべて" }).click();
  await page.getByText("3件").waitFor();
});

await step("本を削除しても、作品は残る", async () => {
  await page.goto(base + "#/library");
  await page.getByText("はじめての北欧ニット").click();
  await page.getByRole("button", { name: "この本を削除" }).click();
  await page.getByRole("alertdialog").getByText("掲載している本の情報だけが外れます").waitFor();
  await page.getByRole("alertdialog").getByRole("button", { name: "削除する" }).click();
  await page.locator(".page.library").waitFor();
  await page.getByText("北欧柄のミトン").click();
  await page.locator(".detail-title", { hasText: "北欧柄のミトン" }).waitFor();
  if (await page.getByText("掲載：").count()) throw new Error("削除した本へのリンクが残っている");
});

for (const s of steps) console.log(s.join("  "));
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(steps.some((s) => s[0] === "NG") || errors.length ? 1 : 0);
