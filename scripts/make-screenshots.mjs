// App Store 用スクリーンショットを作る。
// サンプルの作品データ（store/samples の写真）を実際のアプリに入れて撮影し、見出しを付けて仕上げる。
//   node scripts/make-screenshots.mjs
// 出力：store/screenshots/iphone/*.png（1320×2868）、store/screenshots/ipad/*.png（2064×2752）
// 写真・本の表紙・編み図はすべて見本として用意したもので、実在の作品・書籍ではない。
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "store/screenshots";
const SAMPLES = "store/samples";
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const b64 = (buf) => Buffer.from(buf).toString("base64");
const dataUrl = (file) => `data:image/png;base64,${b64(readFileSync(join(SAMPLES, file)))}`;

async function renderJpeg(html, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><body style="margin:0">${html}</body></html>`, { waitUntil: "load" });
  const buf = await page.screenshot({ type: "jpeg", quality: 88 });
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

// ---------- 表紙（写真を 3:4 の JPEG に縮小） ----------
const photo = async (file) => renderJpeg(`<img src="${dataUrl(file)}" style="width:720px;height:960px;object-fit:cover;display:block">`, 720, 960);
const covers = {
  cardigan: await photo("cardigan.png"),
  mittens: await photo("mittens.png"),
  beret: await photo("beret.png"),
  socks: await photo("socks.png"),
  shawl: await photo("shawl.png"),
  sweater: await photo("sweater.png"),
};

// ---------- 本・電子書籍の表紙（見本の架空の本。store/samples に用意した画像） ----------
const bookCovers = {
  winter: await photo("book-winter.png"),
  knitdays: await photo("book-knitdays.png"),
};

// ---------- 編み図（北欧柄のミトンの編み込みチャート） ----------
// 1 = 紺、0 = 生成り。8枚の花びらの星（セルブ・スター）と縁の模様
const STAR = [
  "000000010000000",
  "000000111000000",
  "000001111100000",
  "011000111000110",
  "011100111001110",
  "001110010011100",
  "000111010111000",
  "111111101111111",
  "000111010111000",
  "001110010011100",
  "011100111001110",
  "011000111000110",
  "000001111100000",
  "000000111000000",
  "000000010000000",
];
function chartGrid() {
  const cols = 27;
  const rows = [];
  const band = (pat) => Array.from({ length: cols }, (_, c) => pat[c % pat.length]);
  rows.push(band("1"), band("0"), band("10"), band("0"), band("1"));
  // 星（中央）。まわりは小さな点模様
  for (const line of STAR) {
    const pad = (cols - line.length) / 2;
    const r = rows.length;
    rows.push(Array.from({ length: cols }, (_, c) => (c >= pad && c < pad + line.length ? line[c - pad] : (c + r) % 4 === 0 ? "1" : "0")));
  }
  rows.push(band("1"), band("0"), band("100"), band("010"), band("0"), band("1"));
  // 手首側の縞
  for (let i = 0; i < 6; i++) rows.push(band("10"));
  return rows.reverse(); // 配列の先頭＝1段目（一番下）
}
function chartSvg() {
  const g = chartGrid();
  const c = 20;
  const W = g[0].length * c;
  const H = g.length * c;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 46}" height="${H + 34}" font-family="sans-serif">`;
  g.forEach((row, ri) => {
    const y = H - (ri + 1) * c;
    row.forEach((v, ci) => {
      s += `<rect x="${ci * c}" y="${y}" width="${c}" height="${c}" fill="${v === "1" ? "#25386b" : "#fbf8f1"}" stroke="#b9b2a6" stroke-width="0.7"/>`;
    });
    if ((ri + 1) % 5 === 0 || ri === 0) s += `<text x="${W + 8}" y="${y + 15}" font-size="12" fill="#555">${ri + 1}</text>`;
  });
  for (let ci = 5; ci < g[0].length; ci += 5) s += `<line x1="${W - ci * c}" y1="0" x2="${W - ci * c}" y2="${H}" stroke="#7a7266" stroke-width="1.4"/>`;
  for (let ri = 5; ri < g.length; ri += 5) s += `<line x1="0" y1="${H - ri * c}" x2="${W}" y2="${H - ri * c}" stroke="#7a7266" stroke-width="1.4"/>`;
  return { svg: s + "</svg>", rows: g.length };
}
const chart = chartSvg();

function patternHtml(lang) {
  const ja = lang === "ja";
  const css = `body{font-family:"Yu Gothic","Meiryo",sans-serif;color:#2b2522;margin:0;padding:44px 52px;font-size:13px;line-height:1.8}
    h1{font-size:28px;margin:0 0 2px;color:#25386b;letter-spacing:1px} .sub{color:#8a7f73;margin-bottom:20px}
    h2{font-size:15px;border-left:5px solid #25386b;padding-left:10px;margin:22px 0 8px}
    table{border-collapse:collapse;width:100%} td{padding:5px 10px;border-bottom:1px solid #e6dfd4;vertical-align:top} td:first-child{width:110px;color:#6b6157}
    .page{page-break-after:always} .legend{display:flex;gap:22px;margin:6px 0 14px} .sw{display:inline-block;width:14px;height:14px;border:1px solid #999;vertical-align:-2px;margin-right:6px}
    .hero{width:100%;height:330px;object-fit:cover;border-radius:6px;margin:4px 0 6px}`;
  const p1 = ja
    ? `<h1>北欧柄のミトン</h1><div class="sub">日本語訳（自分用メモ付き）</div>
       <img class="hero" src="${dataUrl("mittens.png")}">
       <h2>材料</h2><table><tr><td>糸</td><td>中細ウール　紺 40g・生成り 35g</td></tr><tr><td>針</td><td>4号・5号 4本棒針（または輪針）</td></tr><tr><td>ゲージ</td><td>編み込み模様 30目×32段＝10cm角</td></tr><tr><td>サイズ</td><td>手のひら回り 19cm・長さ 25cm</td></tr></table>
       <h2>編み方</h2><ol><li>4号針・紺で56目作り目し、輪にして1目ゴム編みを6cm編む。</li><li>5号針に替え、チャートAの編み込み模様を編む。</li><li>親指位置の11目を別糸に休め、続けて模様を編む。</li><li>指先は両端で減らし、残りの目をメリヤスはぎにする。</li></ol>`
    : `<h1>Nordic Star Mittens</h1><div class="sub">Original pattern</div>
       <img class="hero" src="${dataUrl("mittens.png")}">
       <h2>Materials</h2><table><tr><td>Yarn</td><td>Fingering wool — Navy 40 g, Natural 35 g</td></tr><tr><td>Needles</td><td>US 2 and US 3 DPNs</td></tr><tr><td>Gauge</td><td>30 sts × 32 rnds = 4 in in colorwork</td></tr><tr><td>Size</td><td>Hand circumference 7½ in</td></tr></table>
       <h2>Instructions</h2><ol><li>With smaller needles and Navy, CO 56 sts. Join and work 1×1 rib for 2½ in.</li><li>Change to larger needles and work Chart A.</li><li>Place 11 thumb sts on waste yarn and continue.</li><li>Shape top and graft remaining sts.</li></ol>`;
  const p2 = `<h1>${ja ? "チャートA（甲側）" : "Chart A (back of hand)"}</h1><div class="sub">${ja ? "1マス＝1目。下から上へ編む" : "Read from bottom to top"}</div>
    <div class="legend"><span><span class="sw" style="background:#25386b"></span>${ja ? "紺" : "Navy"}</span><span><span class="sw" style="background:#fbf8f1"></span>${ja ? "生成り" : "Natural"}</span></div>
    <div id="chart">${chart.svg}</div>`;
  return `<html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="page">${p1}</div><div class="page">${p2}</div><div>${p1}</div></body></html>`;
}
const pdfJa = await renderPdf(patternHtml("ja"));
/** 2ページ目の編み図が、ページのどこにあるか（ページの高さに対する割合）を測る */
async function measureChart(html) {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await page.emulateMedia({ media: "print" });
  await page.setContent(html, { waitUntil: "load" });
  const top = await page.evaluate(() => {
    const p2 = document.querySelectorAll(".page")[1].getBoundingClientRect().top;
    return document.querySelector("#chart svg").getBoundingClientRect().top - p2;
  });
  await page.close();
  return top;
}
const PAGE_H = (297 / 25.4) * 96; // A4 の高さ（CSS px）
const chartTop = await measureChart(patternHtml("ja"));
const CELL = 20;
/** 下から r 段目の中心の位置 */
const rowY = (r) => (chartTop + chart.rows * CELL - (r - 0.5) * CELL) / PAGE_H;
const rowH = CELL / PAGE_H;
const pdfEn = await renderPdf(patternHtml("en"));

// ---------- アプリにサンプルデータを入れて撮影 ----------
const server = await createServer({ server: { port: 4190, strictPort: true }, logLevel: "error" });
await server.listen();
const base = "http://localhost:4190/";

async function seed(page) {
  await page.evaluate(
    async ({ pdfJa, pdfEn, covers, bookCovers, chartRows, ruler, mark }) => {
      const repo = await import("/src/db/repo.ts");
      const { db } = await import("/src/db/db.ts");
      const bin = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0)).buffer;
      await repo.ensureDefaultCategories();
      const cats = await db.categories.toArray();
      const cat = (n) => cats.filter((c) => c.name === n).map((c) => c.id);
      const jpg = (s) => ({ type: "image/jpeg", data: bin(s) });
      const pdf = (name, kind, data) => ({ name, kind, mimeType: "application/pdf", data: bin(data), pageCount: 3 });
      const mk = async (o, files = [], cover) => repo.createPattern({ favorite: false, categoryIds: [], tags: [], status: "want", ...o }, files, cover);
      const now = Date.now();

      // 本・電子書籍
      const winter = await mk(
        { title: "Winter Knitting 糸と過ごす特別な季節", itemType: "book", publisher: "ニット舎", categoryIds: cat("小物"), tags: ["冬", "編み込み"] },
        [],
        jpg(bookCovers.winter),
      );
      await mk(
        { title: "KNIT DAYS 編みもののある、やさしい暮らし", itemType: "ebook", publisher: "ニット舎", ebookUrl: "https://example.com/ebook", categoryIds: cat("セーター") },
        [],
        jpg(bookCovers.knitdays),
      );

      // 作品
      await mk({ title: "ラグランセーター", status: "done", categoryIds: cat("セーター"), tags: ["ラグラン"] }, [pdf("raglan.pdf", "original", pdfEn)], jpg(covers.sweater));
      await mk({ title: "木の葉模様の三角ショール", status: "preparing", categoryIds: cat("ショール") }, [pdf("leaf-shawl.pdf", "original", pdfEn)], jpg(covers.shawl));
      await mk({ title: "モヘアのベレー帽", status: "want", categoryIds: cat("帽子") }, [], jpg(covers.beret));
      await mk({ title: "ラベンダーの透かし靴下", status: "want", favorite: true, categoryIds: cat("靴下") }, [pdf("lace-socks.pdf", "original", pdfEn)], jpg(covers.socks));
      await mk(
        { title: "ケーブル編みのカーディガン", status: "in_progress", favorite: true, categoryIds: cat("カーディガン"), tags: ["冬", "ケーブル"], designer: "Knit Studio" },
        [pdf("Cable Cardigan.pdf", "original", pdfEn)],
        jpg(covers.cardigan),
      );
      const main = await mk(
        {
          title: "北欧柄のミトン",
          status: "in_progress",
          favorite: true,
          categoryIds: cat("小物"),
          tags: ["編み込み", "冬"],
          designer: "Nordic Knits",
          sourceBookId: winter,
          sourcePage: "24",
          purchaseUrl: "https://www.ravelry.com/patterns/library/nordic-star-mittens",
          shopName: "Ravelry",
          price: 6,
          currency: "USD",
          yarn: "中細ウール　紺・生成り",
          needles: "4号・5号 4本棒針",
          gauge: "30目×32段 / 10cm",
        },
        [pdf("Nordic Star Mittens.pdf", "original", pdfEn), pdf("北欧柄のミトン_日本語訳.pdf", "translation", pdfJa)],
        jpg(covers.mittens),
      );

      // 段数カウンター
      const c1 = await repo.createCounter(main, "甲側の模様", chartRows);
      await repo.stepCounter(c1, 23);
      const c2 = await repo.createCounter(main, "親指", 18);
      await repo.stepCounter(c2, 6);

      // 日本語訳の2ページ目（チャート）：定規・マーカー・メモ
      const ja = (await db.files.where("patternId").equals(main).toArray()).find((f) => f.kind === "translation");
      // 段数カウンターが23段なので、定規は今編んでいる24段目に置く
      await repo.saveRuler(ja.id, { page: 2, y: ruler.y, height: ruler.h, visible: true, counterId: c1 });
      await repo.addAnnotation({ type: "ink", fileId: ja.id, page: 2, points: [0.066, mark.y, 0.744, mark.y], color: "#f5d000", width: mark.w, opacity: 0.45 });
      await repo.addAnnotation({ type: "note", fileId: ja.id, page: 2, x: 0.86, y: mark.y, text: "ここから親指の目を休める" });
      await repo.saveViewState(ja.id, { page: 2, zoom: 1, scrollXRatio: 0, scrollYRatio: ruler.y + 0.18 });

      // 最近開いた順（ミトンが一番新しい）
      const all = (await db.patterns.toArray()).sort((a, b) => (a.id === main ? -1 : b.id === main ? 1 : 0));
      for (const [i, p] of all.entries()) await db.patterns.update(p.id, { lastOpenedAt: now - i * 3600_000, updatedAt: now - i * 60_000 });
      return main;
    },
    {
      pdfJa: b64(pdfJa),
      pdfEn: b64(pdfEn),
      covers: Object.fromEntries(Object.entries(covers).map(([k, v]) => [k, b64(v)])),
      bookCovers: Object.fromEntries(Object.entries(bookCovers).map(([k, v]) => [k, b64(v)])),
      chartRows: chart.rows,
      ruler: { y: rowY(24), h: rowH },
      mark: { y: rowY(11), w: (CELL / 794) * 0.95 },
    },
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
  const settle = () => page.waitForTimeout(900);
  const canvasReady = (n) => page.waitForFunction((n) => (document.querySelector(`.page-box[data-page="${n}"] canvas`)?.width ?? 0) > 0, n);

  // ライブラリ（写真がずらりと並ぶ）
  await page.goto(base + "#/library");
  await page.getByRole("tab", { name: "すべて" }).click();
  await page.locator(".grid .card").nth(7).waitFor();
  await settle();
  shots.library = await page.screenshot();

  // 作品詳細
  await page.getByText("北欧柄のミトン").first().click();
  await page.locator(".detail-title").waitFor();
  await settle();
  shots.detail = await page.screenshot();

  // 定規＋段数カウンター
  await page.getByRole("link", { name: /日本語訳\.pdf/ }).click();
  await canvasReady(2);
  await page.locator(".ruler-band").waitFor();
  await page.getByRole("button", { name: "段数" }).click();
  await page.waitForTimeout(1400);
  shots.ruler = await page.screenshot();

  // 書き込み
  await page.getByRole("button", { name: "段数" }).click();
  await page.getByRole("button", { name: "定規" }).click();
  await page.getByRole("button", { name: "書込" }).click();
  await page.waitForTimeout(1200);
  shots.annotate = await page.screenshot();
  await page.getByRole("button", { name: "書込" }).click();
  await page.getByRole("button", { name: "定規" }).click();

  // ホーム（制作中）
  await page.goto(base + "#/");
  await page.locator(".wip-card").first().waitFor();
  await settle();
  shots.home = await page.screenshot();

  // 本・電子書籍の棚
  await page.evaluate(() => {
    document.querySelector(".main").style.paddingBottom = "100vh"; // 見出しを画面の上端まで上げられるようにする
    const h = [...document.querySelectorAll("h2")].find((e) => e.textContent?.startsWith("持っている本"));
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 24);
  });
  await settle();
  shots.books = await page.screenshot();

  // プライバシー
  await page.goto(base + "#/settings");
  await page.evaluate(() => {
    document.querySelector(".main").style.paddingBottom = "100vh";
    const h = [...document.querySelectorAll("h2")].find((e) => e.textContent === "プライバシー");
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 16);
  });
  await settle();
  shots.privacy = await page.screenshot();

  // 購入画面（審査用のみ。ストアの画像には使わない）
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
// 最初の数枚が検索結果に出るので、一番の魅力を先頭に置く
const slides = [
  { key: "library", title: "編み図も、本も、\nぜんぶここに。", hero: true },
  { key: "ruler", title: "今編んでいる段が、\nひと目でわかる", sub: "定規と段数カウンターが連動" },
  { key: "detail", title: "英語の原本と日本語訳を\nひとつの作品に", sub: "購入先や糸・針の情報もまとめて" },
  { key: "annotate", title: "マーカーとメモで\n編み図に書き込み", sub: "元のPDFはそのまま" },
  { key: "home", title: "制作中の作品に\nすぐ戻れる", sub: "前回見ていたページから再開" },
  { key: "books", title: "持っている本も\n電子書籍も管理", sub: "バーコードを読むだけで登録" },
  { key: "privacy", title: "データは\n端末の中だけ", sub: "アカウント登録なし・広告なし" },
];

const KNIT_BG = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><path d="M6 6 L22 30 L38 6" fill="none" stroke="rgba(168,98,74,0.07)" stroke-width="6" stroke-linecap="round"/></svg>',
)}")`;

async function compose(device, shots) {
  const phone = device === "iphone";
  const [W, H] = phone ? [1320, 2868] : [2064, 2752];
  const dir = join(OUT, device);
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [i, s] of slides.entries()) {
    const img = `data:image/png;base64,${shots[s.key].toString("base64")}`;
    const lines = s.title.split("\n");
    const maxChars = Math.max(...lines.map((l) => l.length));
    const titleSize = Math.min(phone ? 104 : 112, Math.floor((W * 0.84) / maxChars));
    const shotW = phone ? (s.hero ? 1000 : 1040) : s.hero ? 1440 : 1500;
    const frame = phone ? 16 : 14;
    const radius = phone ? 70 : 44;
    const badges = s.hero
      ? `<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:${phone ? 18 : 22}px;margin:${phone ? 34 : 28}px auto 0;max-width:${phone ? 1100 : 1800}px">${["広告なし", "アカウント不要", "オフラインOK", "5作品まで無料"]
          .map(
            (b) =>
              `<span style="background:#fffaf4;border:3px solid #c7856c;color:#8e4a33;border-radius:999px;padding:${phone ? "10px 24px" : "10px 26px"};font-size:${phone ? 38 : 40}px;font-weight:800;white-space:nowrap">${b}</span>`,
          )
          .join("")}</div>`
      : "";
    // 先頭の1枚は、写真を背景に散らして華やかにする
    const floating = s.hero
      ? [
          ["cardigan.png", phone ? -170 : -40, phone ? 1250 : 900, -9],
          ["shawl.png", phone ? W - 250 : W - 420, phone ? 1120 : 820, 8],
          ["socks.png", phone ? -150 : 30, phone ? 2250 : 1950, 7],
          ["beret.png", phone ? W - 270 : W - 400, phone ? 2200 : 1900, -6],
        ]
          .map(
            ([f, x, y, r]) =>
              `<img src="${dataUrl(f)}" style="position:absolute;left:${x}px;top:${y}px;width:${phone ? 420 : 460}px;height:${phone ? 560 : 610}px;object-fit:cover;border-radius:28px;border:12px solid #fff;box-shadow:0 20px 50px rgba(80,50,30,.22);transform:rotate(${r}deg)">`,
          )
          .join("")
      : "";
    await page.setContent(
      `<html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:'Yu Gothic','Meiryo',sans-serif;
        background:${KNIT_BG},linear-gradient(180deg,#f6e9df 0%,#efdcd0 100%);background-size:44px 44px,auto">
        ${floating}
        <div style="position:relative;text-align:center;padding-top:${phone ? 130 : 100}px">
          <div style="color:#4e2f22;font-weight:800;font-size:${titleSize}px;line-height:1.28;letter-spacing:2px">${lines.join("<br>")}</div>
          ${s.sub ? `<div style="margin-top:${phone ? 28 : 22}px;color:#8e5a44;font-weight:700;font-size:${phone ? 48 : 50}px">${s.sub}</div>` : ""}
          ${badges}
        </div>
        <img src="${img}" style="position:relative;display:block;margin:${phone ? 90 : 70}px auto 0;width:${shotW}px;border-radius:${radius}px;
          border:${frame}px solid #241c18;box-shadow:0 40px 90px rgba(78,47,34,.32)">
      </body></html>`,
      { waitUntil: "load" },
    );
    await page.waitForTimeout(250);
    writeFileSync(join(dir, `${String(i + 1).padStart(2, "0")}-${s.key}.png`), await page.screenshot({ type: "png" }));
  }
  await page.close();
}

for (const device of ["iphone", "ipad"]) {
  const shots = await capture(device);
  await compose(device, shots);
  if (device === "iphone") {
    mkdirSync(join(OUT, "review"), { recursive: true });
    writeFileSync(join(OUT, "review", "paywall.png"), shots.paywall);
  }
  console.log(`${device}: ${slides.length} screenshots`);
}
await browser.close();
await server.close();
