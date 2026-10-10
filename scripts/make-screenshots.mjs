// App Store 用スクリーンショットを作る（サンプルの作品データを入れた実際の画面を撮影し、見出しを付ける）
//   node scripts/make-screenshots.mjs
// 出力：store/screenshots/iphone/*.png（1320×2868）、store/screenshots/ipad/*.png（2064×2752）
// サンプルの編み図・表紙はこのスクリプトで生成したもので、実在の作品ではない。
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "store/screenshots";
const TMP = join(OUT, "_tmp");
mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});

// ---------- サンプル素材 ----------

/** ケーブル模様の編み図チャート（SVG） */
function chartSvg(cols = 24, rows = 28) {
  const c = 22;
  const W = cols * c;
  const H = rows * c;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 40}" height="${H + 30}" viewBox="0 0 ${W + 40} ${H + 30}" font-family="sans-serif">`;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * c;
      const y = r * c;
      const purl = k === 3 || k === 8 || k === 15 || k === 20;
      const cableCol = (k >= 4 && k <= 7) || (k >= 16 && k <= 19);
      s += `<rect x="${x}" y="${y}" width="${c}" height="${c}" fill="${cableCol ? "#fbefe8" : "#fff"}" stroke="#bbb" stroke-width="0.6"/>`;
      if (purl) s += `<line x1="${x + 6}" y1="${y + c / 2}" x2="${x + c - 6}" y2="${y + c / 2}" stroke="#333" stroke-width="1.6"/>`;
    }
    // 6段ごとに交差
    if ((rows - r) % 6 === 0) {
      for (const k0 of [4, 16]) {
        const x = k0 * c;
        const y = r * c;
        s += `<rect x="${x}" y="${y}" width="${c * 4}" height="${c}" fill="#fff" stroke="#333" stroke-width="1"/>`;
        s += `<path d="M${x + 4} ${y + c - 4} L${x + c * 2 + c - 4} ${y + 4} M${x + c * 2 - 4 + c} ${y + c - 4}" stroke="#333" stroke-width="1.6" fill="none"/>`;
        s += `<path d="M${x + c * 2 - 4} ${y + 4} L${x + c * 4 - 4} ${y + c - 4}" stroke="#333" stroke-width="1.6" fill="none"/>`;
      }
    }
    s += `<text x="${W + 6}" y="${r * c + 15}" font-size="11" fill="#666">${rows - r}</text>`;
  }
  for (let k = 0; k < cols; k++) s += `<text x="${k * c + 7}" y="${H + 18}" font-size="10" fill="#666">${cols - k}</text>`;
  return s + "</svg>";
}

function patternHtml(lang) {
  const ja = lang === "ja";
  const css = `body{font-family:"Yu Gothic","Meiryo",sans-serif;color:#2b2522;margin:0;padding:48px 56px;font-size:13px;line-height:1.8}
    h1{font-size:26px;margin:0 0 4px;color:#7a3e2b} .sub{color:#888;margin-bottom:24px} h2{font-size:15px;border-bottom:2px solid #e5cfc4;padding-bottom:4px;margin-top:22px}
    table{border-collapse:collapse} td{padding:3px 14px 3px 0;vertical-align:top} .page{page-break-after:always} .legend span{display:inline-block;margin-right:18px}`;
  const p1 = ja
    ? `<h1>ケーブル編みのカーディガン</h1><div class="sub">日本語訳（個人用メモ）</div>
       <h2>材料</h2><table><tr><td>糸</td><td>並太ウール（約100g/220m）　ベージュ 6〜8玉</td></tr><tr><td>ボタン</td><td>直径18mm　7個</td></tr></table>
       <h2>用具</h2><table><tr><td>針</td><td>6号・8号 輪針（80cm）、とじ針</td></tr><tr><td>その他</td><td>なわ編み針、ステッチマーカー</td></tr></table>
       <h2>ゲージ</h2><p>メリヤス編み 20目×28段＝10cm角（8号針）</p>
       <h2>できあがり寸法</h2><table><tr><td>サイズ</td><td>S / M / L / XL</td></tr><tr><td>胸囲</td><td>92 / 100 / 108 / 116 cm</td></tr><tr><td>着丈</td><td>56 / 58 / 60 / 62 cm</td></tr></table>
       <h2>編み方</h2><ol><li>6号針で作り目を148（164・180・196）目し、2目ゴム編みを6cm編む。</li><li>8号針に替え、チャートAの模様を前後身頃に配置して編む。</li><li>脇から36cm編んだら、袖ぐりの減目をする。</li><li>前立てを拾い、ボタンホールを7か所あける。</li></ol>`
    : `<h1>Cable Cardigan</h1><div class="sub">Original pattern</div>
       <h2>Materials</h2><table><tr><td>Yarn</td><td>Worsted wool (approx. 100g/240yd), 6–8 skeins</td></tr><tr><td>Buttons</td><td>18mm, 7 pcs</td></tr></table>
       <h2>Needles</h2><table><tr><td>Needles</td><td>US 6 and US 8 circular needles</td></tr><tr><td>Notions</td><td>Cable needle, stitch markers</td></tr></table>
       <h2>Gauge</h2><p>20 sts × 28 rows = 4 in in stockinette on US 8</p>
       <h2>Sizes</h2><p>S (M, L, XL) — finished chest 36 (39, 42½, 45½) in</p>
       <h2>Instructions</h2><ol><li>With smaller needle, CO 148 (164, 180, 196) sts. Work in 2x2 rib for 2½ in.</li><li>Change to larger needle and work Chart A as set.</li><li>When piece measures 14 in from CO, shape armholes.</li><li>Pick up stitches for button band and work 7 buttonholes.</li></ol>`;
  const p2 = `<h1>${ja ? "チャートA" : "Chart A"}</h1><div class="sub">${ja ? "記号の見方" : "Key"}</div>
    <div class="legend"><span>□ ${ja ? "表目" : "knit"}</span><span>－ ${ja ? "裏目" : "purl"}</span><span>⤫ ${ja ? "2目交差" : "2/2 cable"}</span></div>
    <div style="margin-top:16px">${chartSvg()}</div>`;
  return `<html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="page">${p1}</div><div class="page">${p2}</div><div>${p1}</div></body></html>`;
}

/** 表紙のイラスト（編み目模様） */
function coverSvg(shape, bg, yarn) {
  const knit = `<pattern id="v" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M2 2 L8 13 L14 2" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3" stroke-linecap="round"/></pattern>`;
  const shapes = {
    cardigan: `<path d="M150 170 L230 140 Q300 170 370 140 L450 170 L520 330 L460 360 L440 300 L440 640 L160 640 L160 300 L140 360 L80 330 Z"/><line x1="300" y1="175" x2="300" y2="640" stroke="rgba(0,0,0,.18)" stroke-width="4"/>`,
    hat: `<path d="M150 520 Q150 260 300 230 Q450 260 450 520 Z"/><rect x="135" y="500" width="330" height="90" rx="20"/><circle cx="300" cy="215" r="48"/>`,
    socks: `<path d="M200 140 h120 v300 q0 70 -60 110 l-90 60 q-60 30 -90 -20 q-20 -50 40 -80 l80 -60 z"/><path d="M360 160 h110 v290 q0 70 -55 105 l-80 55 q-55 25 -80 -20 l60 -50 q45 -35 45 -90 z" opacity=".85"/>`,
    shawl: `<path d="M80 200 L520 200 L300 600 Z"/><path d="M80 200 L520 200" stroke="rgba(255,255,255,.7)" stroke-width="10"/>`,
    mittens: `<path d="M150 600 v-260 q0 -120 90 -120 q90 0 90 120 v40 l40 -40 q35 -30 55 10 q15 30 -15 60 l-80 90 v100 z"/>`,
    sweater: `<path d="M160 170 L240 140 Q300 175 360 140 L440 170 L520 340 L455 370 L430 300 L430 640 L170 640 L170 300 L145 370 L80 340 Z"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><defs>${knit}</defs>
    <rect width="600" height="800" fill="${bg}"/>
    <g transform="translate(0,60)" fill="${yarn}">${shapes[shape]}</g>
    <g transform="translate(0,60)" fill="url(#v)">${shapes[shape]}</g></svg>`;
}

async function renderPng(html, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><body style="margin:0">${html}</body></html>`);
  const buf = await page.screenshot({ type: "png" });
  await page.close();
  return buf;
}
async function renderPdf(html) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const buf = await page.pdf({ format: "A4", printBackground: true });
  await page.close();
  return buf;
}

const pdfJa = await renderPdf(patternHtml("ja"));
const pdfEn = await renderPdf(patternHtml("en"));
const covers = {
  cardigan: await renderPng(coverSvg("cardigan", "#efe3d6", "#b88a6a"), 600, 800),
  hat: await renderPng(coverSvg("hat", "#e3ebe0", "#7f9a78"), 600, 800),
  socks: await renderPng(coverSvg("socks", "#ece4f1", "#9a86b5"), 600, 800),
  shawl: await renderPng(coverSvg("shawl", "#f4e9d8", "#d0a35c"), 600, 800),
  mittens: await renderPng(coverSvg("mittens", "#e2ebf1", "#6f93ad"), 600, 800),
  sweater: await renderPng(coverSvg("sweater", "#f2e1df", "#c27f78"), 600, 800),
};

// ---------- アプリにサンプルデータを入れて撮影 ----------

const server = await createServer({ server: { port: 4190, strictPort: true }, logLevel: "error" });
await server.listen();
const base = "http://localhost:4190/";

async function seed(page) {
  const b64 = (buf) => Buffer.from(buf).toString("base64");
  await page.evaluate(
    async ({ pdfJa, pdfEn, covers }) => {
      const repo = await import("/src/db/repo.ts");
      const { db } = await import("/src/db/db.ts");
      const bin = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0)).buffer;
      await repo.ensureDefaultCategories();
      const cats = await db.categories.toArray();
      const cat = (n) => cats.filter((c) => c.name === n).map((c) => c.id);
      const png = (k) => ({ type: "image/png", data: bin(covers[k]) });
      const pdf = (name, kind, data, pageCount) => ({ name, kind, mimeType: "application/pdf", data: bin(data), pageCount });
      const mk = async (o, files = [], cover) => repo.createPattern({ favorite: false, categoryIds: [], tags: [], ...o }, files, cover);
      const now = Date.now();
      const main = await mk(
        { title: "ケーブル編みのカーディガン", status: "in_progress", favorite: true, categoryIds: cat("カーディガン"), tags: ["冬", "ケーブル"], designer: "Knit Studio", shopName: "Ravelry", purchaseUrl: "https://www.ravelry.com/patterns/library/cable-cardigan", price: 8, currency: "USD", yarn: "並太ウール・6〜8玉", needles: "6号・8号 輪針", gauge: "20目×28段 / 10cm" },
        [pdf("Cable Cardigan.pdf", "original", pdfEn, 3), pdf("ケーブルカーディガン_日本語訳.pdf", "translation", pdfJa, 3)],
        png("cardigan"),
      );
      await mk({ title: "モヘアのベレー帽", status: "in_progress", categoryIds: cat("帽子"), designer: "Petit Laine" }, [pdf("beret.pdf", "original", pdfEn, 3)], png("hat"));
      await mk({ title: "ラベンダー色の靴下", status: "want", favorite: true, categoryIds: cat("靴下") }, [], png("socks"));
      await mk({ title: "三角ショール", status: "preparing", categoryIds: cat("ショール") }, [pdf("shawl.pdf", "original", pdfEn, 3)], png("shawl"));
      await mk({ title: "北欧柄のミトン", status: "want", categoryIds: cat("小物") }, [], png("mittens"));
      await mk({ title: "ラグランセーター", status: "done", categoryIds: cat("セーター") }, [pdf("raglan.pdf", "original", pdfEn, 3)], png("sweater"));
      // 段数カウンター
      const c1 = await repo.createCounter(main, "身頃", 120);
      await repo.stepCounter(c1, 48);
      const c2 = await repo.createCounter(main, "模様（6段ごとに交差）", 6);
      await repo.stepCounter(c2, 4);
      // 日本語訳PDFの2ページ目（チャート）に書き込み
      const ja = (await db.files.where("patternId").equals(main).toArray()).find((f) => f.kind === "translation");
      await repo.addAnnotation({ type: "ink", fileId: ja.id, page: 2, points: [0.06, 0.505, 0.93, 0.505], color: "#f5d000", width: 0.03, opacity: 0.4 });
      // 交差の位置をペンで丸囲み
      const circle = [];
      for (let i = 0; i <= 28; i++) {
        const t = (i / 28) * Math.PI * 2;
        circle.push(0.235 + 0.085 * Math.cos(t), 0.33 + 0.028 * Math.sin(t));
      }
      await repo.addAnnotation({ type: "ink", fileId: ja.id, page: 2, points: circle, color: "#e53935", width: 0.005, opacity: 1 });
      await repo.addAnnotation({ type: "note", fileId: ja.id, page: 2, x: 0.86, y: 0.42, text: "ここから袖ぐりの減目" });
      await repo.saveViewState(ja.id, { page: 2, zoom: 1, scrollXRatio: 0, scrollYRatio: 0.5 });
      // 最近開いた順
      const all = await db.patterns.toArray();
      for (const [i, p] of all.entries()) await db.patterns.update(p.id, { lastOpenedAt: now - i * 3600_000 });
      return main;
    },
    { pdfJa: b64(pdfJa), pdfEn: b64(pdfEn), covers: Object.fromEntries(Object.entries(covers).map(([k, v]) => [k, b64(v)])) },
  );
}

async function capture(device) {
  const phone = device === "iphone";
  const ctx = await browser.newContext({
    viewport: phone ? { width: 440, height: 956 } : { width: 1032, height: 1376 },
    deviceScaleFactor: phone ? 3 : 2,
    locale: "ja-JP",
    colorScheme: "light",
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByText("編み図ライブラリへようこそ").waitFor();
  await seed(page);
  const shots = {};
  const settle = () => page.waitForTimeout(800);

  await page.goto(base + "#/");
  await page.locator(".wip-card").first().waitFor();
  await settle();
  shots.home = await page.screenshot();

  await page.goto(base + "#/library");
  await page.locator(".grid .card").nth(5).waitFor();
  await settle();
  shots.library = await page.screenshot();

  await page.goto(base + "#/library");
  await page.getByText("ケーブル編みのカーディガン").click();
  await page.locator(".detail-title").waitFor();
  await settle();
  shots.detail = await page.screenshot();

  await page.getByRole("link", { name: /日本語訳\.pdf/ }).click();
  await page.waitForFunction(() => (document.querySelector('.page-box[data-page="2"] canvas')?.width ?? 0) > 0);
  await page.locator('.page-box[data-page="2"] .note-pin').waitFor();
  await page.getByRole("button", { name: "段数" }).click();
  await page.waitForTimeout(1200);
  shots.counter = await page.screenshot();

  await page.getByRole("button", { name: "段数" }).click();
  await page.getByRole("button", { name: "書込" }).click();
  await page.waitForTimeout(1200);
  shots.annotate = await page.screenshot();

  await page.goto(base + "#/settings");
  await page.evaluate(() => {
    // 末尾の「プライバシー」が見えるよう、余白を足してから見出しを画面上部に合わせる
    document.querySelector(".main").style.paddingBottom = "100vh";
    const h = [...document.querySelectorAll("h2")].find((e) => e.textContent === "プライバシー");
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 16);
  });
  await settle();
  shots.privacy = await page.screenshot();

  // プレミアムの案内（6件目を登録しようとしたとき）。開発サーバー専用の表示切り替えで、購入画面を再現する
  await page.goto(base + "#/");
  await page.evaluate(async () => {
    const m = await import("/src/lib/premium.ts");
    m.__previewPremium(
      { enforced: true, active: false, checking: false },
      { id: m.PREMIUM_PRODUCT_ID, displayName: "プレミアム（月額）", description: "", displayPrice: "¥150", price: 150, period: { unit: "month", value: 1 } },
    );
  });
  await page.goto(base + "#/new");
  await page.locator(".paywall-buy").waitFor();
  await settle();
  shots.paywall = await page.screenshot();
  await ctx.close();
  return shots;
}

// ---------- 見出しを付けて仕上げる ----------

const captions = [
  ["home", "制作中の作品に、", "すぐ戻れる"],
  ["detail", "原本と日本語訳を、", "作品ごとにひとつに"],
  ["counter", "編みながら", "段数カウンター"],
  ["annotate", "マーカーとメモで", "編み図に書き込み"],
  ["library", "編みたい作品も完成品も", "すっきり整理"],
  ["privacy", "アカウント不要。", "データは端末の中だけ"],
  ["paywall", "5作品まで無料。", "それ以上は月額150円で無制限"],
];

async function compose(device, shots) {
  const phone = device === "iphone";
  const [W, H] = phone ? [1320, 2868] : [2064, 2752];
  const dir = join(OUT, device);
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  let i = 0;
  for (const [key, l1, l2] of captions) {
    const img = `data:image/png;base64,${shots[key].toString("base64")}`;
    const shotW = phone ? 1060 : 1560;
    // 長い見出しは、端からはみ出さないよう文字を小さくする
    const maxChars = Math.max(l1.length, l2.length);
    const fontSize = Math.min(phone ? 92 : 104, Math.floor((W * 0.86) / maxChars));
    await page.setContent(`<html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:linear-gradient(180deg,#f3e6dc,#efe0d3);font-family:'Yu Gothic','Meiryo',sans-serif">
      <div style="text-align:center;padding-top:${phone ? 150 : 120}px;color:#5a3a2c;font-weight:800;font-size:${fontSize}px;line-height:1.3;letter-spacing:2px">${l1}<br>${l2}</div>
      <img src="${img}" style="display:block;margin:${phone ? 110 : 90}px auto 0;width:${shotW}px;border-radius:${phone ? 64 : 40}px;box-shadow:0 30px 80px rgba(90,58,44,.28);border:${phone ? 14 : 12}px solid #2b2522">
      </body></html>`);
    await page.waitForTimeout(200);
    const name = `${String(++i).padStart(2, "0")}-${key}.png`;
    writeFileSync(join(dir, name), await page.screenshot({ type: "png" }));
  }
  await page.close();
}

for (const device of ["iphone", "ipad"]) {
  const shots = await capture(device);
  await compose(device, shots);
  // サブスクリプション審査用（購入画面そのもの）
  if (device === "iphone") {
    mkdirSync(join(OUT, "review"), { recursive: true });
    writeFileSync(join(OUT, "review", "paywall.png"), shots.paywall);
  }
  console.log(`${device}: ${captions.length} screenshots`);
}
writeFileSync(join(TMP, "sample-ja.pdf"), pdfJa);
await browser.close();
await server.close();
void readFileSync;
