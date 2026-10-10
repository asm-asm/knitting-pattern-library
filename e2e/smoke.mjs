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
let at = "";
const mark = (m) => (at = m);
async function step(name, fn) {
  at = "";
  try {
    await fn();
    steps.push(["OK", name]);
  } catch (e) {
    steps.push(["NG", name, `[${at}] ` + String(e).split("\n")[0]]);
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

const canvasReady = (n) =>
  page.waitForFunction((n) => (document.querySelector(`.page-box[data-page="${n}"] canvas`)?.width ?? 0) > 0, n);
const pageSelect = () => page.getByLabel("ページ移動");
const scrollViewerTop = () => page.evaluate(() => document.querySelector(".viewer-scroll").scrollTo(0, 0));
const fileSelect = () => page.getByLabel("表示するファイル");

await step("PDFビューア：原本と日本語版を別々に開き、閲覧位置をファイルごとに保持", async () => {
  await page.locator(".wip-card").first().click();
  await page.getByRole("link", { name: /Cable Sweater\.pdf/ }).click();
  await canvasReady(1);
  await pageSelect().selectOption("3"); // 4ページ目
  await canvasReady(4);
  await page.getByRole("button", { name: "拡大" }).click();
  await page.getByRole("button", { name: "幅に合わせる" }).filter({ hasText: "125%" }).waitFor();
  await page.waitForTimeout(900); // 閲覧位置の保存を待つ
  await shot("08-viewer-en");

  await fileSelect().selectOption({ label: "日本語翻訳版：ケーブルセーター_日本語.pdf" });
  await canvasReady(1);
  if ((await pageSelect().inputValue()) !== "0") throw new Error("日本語版が1ページ目から開かれていない");
  await pageSelect().selectOption("5");
  await page.waitForTimeout(900);

  await fileSelect().selectOption({ label: "英語原本：Cable Sweater.pdf" });
  await canvasReady(4);
  if ((await pageSelect().inputValue()) !== "3") throw new Error("英語原本の閲覧ページが復元されない");
  await page.getByRole("button", { name: "幅に合わせる" }).filter({ hasText: "125%" }).waitFor();
  await page.reload();
  await canvasReady(4);
  if ((await pageSelect().inputValue()) !== "3") throw new Error("再読み込み後に閲覧ページが復元されない");
  await fileSelect().selectOption({ label: "日本語翻訳版：ケーブルセーター_日本語.pdf" });
  await canvasReady(6);
  if ((await pageSelect().inputValue()) !== "5") throw new Error("日本語版の閲覧ページが復元されない");
});

await step("段数カウンター：複数作成・加減算・再読み込み後も保持・リセット確認", async () => {
  await page.getByRole("button", { name: "段数" }).click();
  for (const [name, target] of [["身頃", "100"], ["左袖", ""]]) {
    await page.getByRole("button", { name: "＋ カウンターを追加" }).click();
    await page.getByLabel("カウンター名").fill(name);
    await page.getByLabel("目標段数").fill(target);
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await page.getByText(name, { exact: true }).waitFor();
  }
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "身頃 を1段進める" }).click();
  await page.getByRole("button", { name: "身頃 を1段戻す" }).click();
  await page.getByRole("button", { name: "左袖 を1段進める" }).click();
  await shot("09-viewer-counters");
  await page.reload();
  await page.getByRole("button", { name: "段数" }).click();
  const values = await page.locator(".counter-num").allTextContents();
  if (values.join(",") !== "2,1") throw new Error("カウンター値が保持されていない: " + values);
  await page.getByRole("button", { name: "作品詳細に戻る" }).click();
  await page.locator(".counter-card", { hasText: "身頃" }).getByRole("button", { name: "リセット" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "キャンセル" }).click();
  if ((await page.locator(".counter-num").first().textContent()) !== "2") throw new Error("キャンセルしたのにリセットされた");
  await page.locator(".counter-card", { hasText: "身頃" }).getByRole("button", { name: "リセット" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "リセット" }).click();
  await page.locator(".counter-num").first().filter({ hasText: /^0$/ }).waitFor();
});

await step("書き込み：マーカー・メモが再読み込み後も同じ位置に表示、元に戻す・消しゴム", async () => {
  await page.getByRole("link", { name: /Cable Sweater\.pdf/ }).click();
  await pageSelect().selectOption("0");
  await canvasReady(1);
  await scrollViewerTop();
  await page.getByRole("button", { name: "書込" }).click();
  const layer = page.locator('.page-box[data-page="1"] .annot-layer');
  const box = await layer.boundingBox();
  const drag = async (y) => {
    await page.mouse.move(box.x + box.width * 0.2, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + y, { steps: 8 });
    await page.mouse.move(box.x + box.width * 0.8, box.y + y, { steps: 8 });
    await page.mouse.up();
  };
  await drag(box.height * 0.3);
  const paths = layer.locator("svg path");
  await paths.nth(0).waitFor({ state: "attached" });
  const rel = async () => {
    const [p, b] = [await paths.first().boundingBox(), await layer.boundingBox()];
    return [(p.x - b.x) / b.width, (p.y - b.y) / b.height].map((v) => v.toFixed(2)).join(",");
  };
  const before = await rel();

  // メモ
  mark("note");
  await page.locator(".annot-toolbar").getByRole("button", { name: "メモ" }).click();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.getByLabel("メモの内容").fill("ここで減目");
  await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  await layer.locator(".note-pin").waitFor();

  // 元に戻す
  mark("undo");
  await page.locator(".annot-toolbar").getByRole("button", { name: "マーカー" }).click();
  await drag(box.height * 0.6);
  await paths.nth(1).waitFor({ state: "attached" });
  await page.getByRole("button", { name: "元に戻す" }).click();
  await page.waitForFunction(() => document.querySelectorAll('.page-box[data-page="1"] svg path').length === 1);
  await shot("10-viewer-annotations");

  // 倍率を変えても位置がずれない
  mark("zoom");
  await page.getByRole("button", { name: "拡大" }).click();
  await page.getByRole("button", { name: "拡大" }).click();
  await page.waitForTimeout(300);
  if ((await rel()) !== before) throw new Error(`拡大後に位置がずれた ${before} → ${await rel()}`);
  await page.getByRole("button", { name: "幅に合わせる" }).click();

  mark("reload");
  await page.reload();
  await canvasReady(1);
  await layer.locator(".note-pin").waitFor();
  if ((await paths.count()) !== 1) throw new Error("再読み込み後にマーカーが残っていない");
  if ((await rel()) !== before) throw new Error("再読み込み後に位置がずれた");

  // 消しゴム → 元に戻す
  mark("eraser");
  await scrollViewerTop();
  await page.getByRole("button", { name: "書込" }).click();
  await page.locator(".annot-toolbar").getByRole("button", { name: "消しゴム" }).click();
  const b2 = await layer.boundingBox();
  await page.mouse.click(b2.x + b2.width * 0.5, b2.y + b2.height * 0.3);
  await page.waitForFunction(() => document.querySelectorAll('.page-box[data-page="1"] svg path').length === 0);
  await page.getByRole("button", { name: "元に戻す" }).click();
  await paths.first().waitFor({ state: "attached" });

  // 一覧
  mark("list");
  await page.getByRole("button", { name: "一覧" }).click();
  await page.locator(".annot-list").getByText("ここで減目").waitFor();
  await shot("11-viewer-annot-list");
  await page.getByRole("button", { name: "作品詳細に戻る" }).click();
});

await step("オフラインでも起動・閲覧・編集できる", async () => {
  await page.goto(base);
  // Service Worker の準備完了を待ってからオフラインにする
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.getByText("オフラインです").waitFor();
  mark("offline-click");
  await page.locator(".wip-card").first().click();
  await page.getByRole("radio", { name: "一時中断" }).click();
  await page.getByRole("radio", { name: "一時中断", checked: true }).waitFor();
  // オフラインでも PDF を開ける
  await page.getByRole("link", { name: /ケーブルセーター_日本語.pdf/ }).click();
  await canvasReady(6);
  await shot("07-offline-viewer");
  await context.setOffline(false);
});

await step("完全バックアップ → 全データ削除 → 復元", async () => {
  await page.goto(base + "#/settings");
  mark("backup");
  await page.getByRole("button", { name: "完全バックアップを作成（PDF・画像を含む）" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ファイルを保存" }).click();
  const download = await downloadPromise;
  const backupPath = join(outDir, download.suggestedFilename());
  await download.saveAs(backupPath);
  if (!/^knitting-library-backup-\d{8}-\d{4}\.zip$/.test(download.suggestedFilename())) throw new Error("ファイル名が想定外: " + download.suggestedFilename());
  await page.getByText(/最後のバックアップ：\d/).waitFor();

  mark("wipe");
  await page.getByRole("button", { name: "すべてのデータを削除" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "次へ" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "すべて削除" }).click();
  await page.locator(".toast", { hasText: "すべてのデータを削除しました" }).waitFor();
  await page.goto(base);
  await page.getByText("編み図ライブラリへようこそ").waitFor();

  mark("restore");
  await page.goto(base + "#/settings");
  await page.locator('input[type=file][accept*=".zip"]').setInputFiles(backupPath);
  await page.getByRole("dialog").getByText("作品2件").waitFor();
  await shot("12-restore-dialog");
  await page.getByRole("dialog").getByRole("button", { name: "追加で復元" }).click();
  await page.locator(".toast", { hasText: "作品2件" }).waitFor();

  mark("verify");
  await page.goto(base + "#/library");
  await page.getByText("ケーブル編みのセーター").click();
  await page.locator(".counter-num").nth(1).waitFor();
  if ((await page.locator(".counter-num").allTextContents()).join(",") !== "0,1") throw new Error("カウンターが復元されていない");
  await page.getByRole("link", { name: /Cable Sweater\.pdf/ }).click();
  await canvasReady(1);
  await page.locator('.page-box[data-page="1"] .note-pin').waitFor();

  // 同じバックアップをもう一度「追加で復元」しても重複しない
  mark("restore-twice");
  await page.goto(base + "#/settings");
  await page.locator('input[type=file][accept*=".zip"]').setInputFiles(backupPath);
  await page.getByRole("dialog").getByRole("button", { name: "追加で復元" }).click();
  await page.locator(".toast", { hasText: "すでに登録済みの作品2件" }).waitFor();
});

await step("ファイル本体が失われている場合はエラーを表示する", async () => {
  // IndexedDB からファイル本体だけを直接削除して、データ欠損を再現する
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("knitting-pattern-library");
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(["files", "blobs"], "readwrite");
          tx.objectStore("files").getAll().onsuccess = (e) => {
            const f = e.target.result.find((x) => x.name.includes("日本語"));
            tx.objectStore("blobs").delete(f.blobId);
          };
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.goto(base + "#/library");
  await page.getByText("ケーブル編みのセーター").click();
  await page.getByRole("link", { name: /ケーブルセーター_日本語\.pdf/ }).click();
  await page.getByText("ファイルの本体が見つかりません").waitFor();
  await shot("13-missing-file");
  await page.getByRole("link", { name: "作品に戻る" }).click();
});

await step("戻るボタンが作品詳細とPDFの間でループしない", async () => {
  const atLibrary = () => page.locator(".page.library").waitFor();
  const atDetail = () => page.locator(".detail-title", { hasText: "ケーブル編みのセーター" }).waitFor();
  const back = () => page.getByRole("button", { name: "‹ 戻る" }).click();
  const viewerBack = () => page.getByRole("button", { name: "作品詳細に戻る" }).click();

  mark("pdf-link");
  await page.goto(base + "#/library");
  await page.getByText("ケーブル編みのセーター").click();
  await atDetail();
  await page.getByRole("link", { name: /Cable Sweater\.pdf/ }).click();
  await canvasReady(1);
  await viewerBack();
  await atDetail();
  await back();
  await atLibrary();

  mark("start-button");
  await page.getByText("ケーブル編みのセーター").click();
  await page.locator(".btn-start").click();
  await page.locator(".viewer").waitFor();
  await viewerBack();
  await atDetail();
  await back();
  await atLibrary();

  mark("edit");
  await page.getByText("ケーブル編みのセーター").click();
  await page.getByRole("link", { name: "編集" }).click();
  await page.getByRole("button", { name: "変更を保存する" }).click();
  await atDetail();
  await back();
  await atLibrary();

  mark("direct-open");
  // PDF を直接開いた場合（再読み込みなど）も、戻るは作品詳細 → ライブラリの順
  await page.getByText("ケーブル編みのセーター").click();
  await page.getByRole("link", { name: /Cable Sweater\.pdf/ }).click();
  await canvasReady(1);
  await page.reload();
  await canvasReady(1);
  await viewerBack();
  await atDetail();
  await back();
  await atLibrary();
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
