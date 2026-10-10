// 「これ持ってる？」の確認（npm run build 後に実行）
// 本の情報の取得（openBD）はテスト用の応答に置き換える。
import { chromium } from "playwright-core";
import { preview } from "vite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";

const outDir = process.env.E2E_OUT ?? join(tmpdir(), "kpl-e2e");
mkdirSync(outDir, { recursive: true });
const server = await preview({ preview: { port: 4187, strictPort: true }, logLevel: "error" });
const base = "http://localhost:4187/";
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ja-JP" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const BOOKS = {
  "9780306406157": { title: "はじめての北欧ニット", author: "山田,花子", publisher: "手芸出版社" },
  "9784529058834": { title: "毎日着たい手編みのニット 新装版", author: "佐藤,あみ", publisher: "あみもの書房" },
  "9780804429573": { title: "かぎ針で編むあみぐるみ", author: "鈴木,糸", publisher: "レース舎" },
};
await page.route("https://api.openbd.jp/**", (route) => {
  const isbn = new URL(route.request().url()).searchParams.get("isbn");
  const b = BOOKS[isbn];
  route.fulfill({ contentType: "application/json", body: JSON.stringify([b ? { summary: { ...b, volume: "", cover: "" } } : null]) });
});
await page.route("https://www.googleapis.com/**", (route) => route.fulfill({ contentType: "application/json", body: '{"totalItems":0}' }));

const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push(["OK", name]);
  } catch (e) {
    steps.push(["NG", name, String(e).split("\n")[0]]);
    await page.screenshot({ path: join(outDir, `check-fail-${steps.length}.png`) });
  }
}

// 準備：ISBN 付きの本1冊と、ISBN なしで登録した本1冊
await page.goto(base);
await page.getByText("編み図ライブラリへようこそ").waitFor();
for (const [title, isbn] of [["はじめての北欧ニット", "9780306406157"], ["毎日着たい手編みのニット", ""]]) {
  await page.goto(base + "#/new?type=book");
  await page.reload();
  if (isbn) await page.getByLabel("ISBN（本の裏の13桁の番号）").fill(isbn);
  await page.getByLabel("書名（必須）").fill(title);
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await page.locator(".detail-title", { hasText: title }).waitFor();
}
const ask = async (q) => {
  await page.getByLabel("調べたい本や作品").fill(q);
  await page.getByRole("button", { name: "調べる" }).click();
};

await step("ホームから開いて、ISBN が一致すれば「持っています」", async () => {
  await page.goto(base);
  await page.getByRole("link", { name: "これ持ってる？" }).click();
  await ask("978-0-306-40615-7");
  await page.locator(".verdict.owned", { hasText: "持っています" }).waitFor();
  await page.locator(".check-items").getByText("はじめての北欧ニット").waitFor();
  await page.screenshot({ path: join(outDir, "check-01-owned.png") });
});

await step("ISBN なしで登録した本も、書名が似ていれば候補に出る", async () => {
  await page.getByRole("button", { name: "ほかのものを調べる" }).click();
  await ask("9784529058834");
  await page.locator(".verdict.maybe", { hasText: "似た名前の本があります" }).waitFor();
  await page.locator(".check-items").getByText("毎日着たい手編みのニット").waitFor();
  await page.screenshot({ path: join(outDir, "check-02-maybe.png") });
});

await step("持っていない本は、そのまま登録できる", async () => {
  await page.getByRole("button", { name: "ほかのものを調べる" }).click();
  await ask("080442957X");
  await page.locator(".verdict.not-owned", { hasText: "まだ持っていません" }).waitFor();
  await page.getByText("かぎ針で編むあみぐるみ").waitFor();
  await page.screenshot({ path: join(outDir, "check-03-not-owned.png") });
  await page.getByRole("button", { name: "本として登録" }).click();
  if ((await page.getByLabel("書名（必須）").inputValue()) !== "かぎ針で編むあみぐるみ") throw new Error("書名が引き継がれていない");
  if ((await page.getByLabel("著者").inputValue()) !== "鈴木糸") throw new Error("著者が引き継がれていない");
  if ((await page.getByLabel("ISBN（本の裏の13桁の番号）").inputValue()) !== "978-0804429573") throw new Error("ISBN が引き継がれていない");
  await page.getByRole("button", { name: "この内容で登録する" }).click();
  await page.locator(".detail-title", { hasText: "かぎ針で編むあみぐるみ" }).waitFor();
});

await step("書名や作品名の文字でも探せる", async () => {
  await page.goto(base + "#/check");
  await ask("北欧");
  await page.locator(".verdict.owned", { hasText: "1件 見つかりました" }).waitFor();
  await page.getByRole("button", { name: "ほかのものを調べる" }).click();
  await ask("アラン模様");
  await page.locator(".verdict.not-owned", { hasText: "見つかりませんでした" }).waitFor();
});

await step("オフラインでも、ISBN で登録した本は確かめられる", async () => {
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "ほかのものを調べる" }).click();
  await ask("9780306406157");
  await page.locator(".verdict.owned", { hasText: "持っています" }).waitFor();
  await page.context().setOffline(false);
});

for (const s of steps) console.log(s.join("  "));
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(steps.some((s) => s[0] === "NG") || errors.length ? 1 : 0);
