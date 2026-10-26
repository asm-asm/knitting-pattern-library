// App Store プレビュー動画（HyperFrames）の構成ファイルを作る。
//   node store/preview/build-film.mjs iphone   → store/preview/film-iphone/
//   node store/preview/build-film.mjs ipad     → store/preview/film-ipad/
// 映像はすべて、実際のアプリを操作して録画したもの（store/preview/footage/<device>/、make-screenshots.mjs --footage）。
// その上に見出しとタップの印を重ねるだけで、アプリの画面を描き直すことはしない（App Store ガイドライン 2.3.4）。
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const device = process.argv[2] ?? "iphone";
const phone = device === "iphone";
const ROOT = join("store", "preview");
const OUT = join(ROOT, `film-${device}`);
const FOOT = join(ROOT, "footage", device);
const clips = Object.fromEntries(JSON.parse(readFileSync(join(FOOT, "clips.json"), "utf8")).clips.map((c) => [c.name, c]));

// ---- 寸法（端末ごと） ----
const W = phone ? 886 : 1200;
const H = phone ? 1920 : 1600;
const SW = phone ? 760 : 960; // 画面（録画）の幅
const SH = Math.round((SW * H) / W); // 録画は動画と同じ縦横比
const SX = Math.round((W - SW) / 2);
const SY = phone ? 372 : 318;
const TITLE = phone ? 58 : 60;
const SUB = phone ? 32 : 32;
const CAP_TOP = phone ? 112 : 70;

// ---- 場面の時間 ----
const SCENES = [
  { id: "s1", start: 0, dur: 5.0 },
  { id: "s2", start: 5.0, dur: 5.4 },
  { id: "s3", start: 10.4, dur: 5.4 },
  { id: "s4", start: 15.8, dur: 4.4 },
  { id: "s5", start: 20.2, dur: 4.3 },
];
const TOTAL = 24.5;

// ---- 素材：録画の最後のフレームを2秒延ばして、場面の終わりまで画面が消えないようにする ----
mkdirSync(join(OUT, "assets"), { recursive: true });
for (const name of ["library", "bulk", "check", "ruler"]) {
  const out = join(OUT, "assets", `${name}.mp4`);
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", join(FOOT, `${name}.mp4`), "-vf", "tpad=stop_mode=clone:stop_duration=2", "-an", "-c:v", "libx264", "-crf", "14", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("ffmpeg " + name);
}
// 最後の場面で、画面がアイコンに縮む最初のフレーム（定規の録画の最後）
spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-sseof", "-0.1", "-i", join(FOOT, "ruler.mp4"), "-frames:v", "1", join(OUT, "assets", "ruler-last.png")], { stdio: "inherit" });
copyFileSync(join("resources", "icon-1024.png"), join(OUT, "assets", "icon.png"));

// ---- 共通の見た目 ----
const KNIT = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><path d="M6 6 L22 30 L38 6" fill="none" stroke="rgba(168,98,74,0.07)" stroke-width="6" stroke-linecap="round"/></svg>',
)}")`;
const baseCss = (id) => `
    #root { position: absolute; inset: 0; overflow: hidden; font-family: "Noto Sans JP", sans-serif;
      background: ${KNIT}, linear-gradient(180deg, #f6e9df 0%, #efdcd0 100%); background-size: 44px 44px, auto; }
    #${id}-cap { position: absolute; left: ${Math.round(W * 0.08)}px; right: ${Math.round(W * 0.08)}px; top: ${CAP_TOP}px; text-align: center; color: #4e2f22; z-index: 5; }
    #${id}-cap .l { display: block; white-space: nowrap; font-weight: 900; font-size: ${TITLE}px; line-height: 1.28; letter-spacing: 0.02em; }
    #${id}-cap .l em { font-style: normal; color: #a8624a; }
    #${id}-cap .sub { display: block; margin-top: ${phone ? 16 : 12}px; font-weight: 700; font-size: ${SUB}px; color: #8e5a44; letter-spacing: 0.02em; }
    #${id}-cam { position: absolute; left: ${SX}px; top: ${SY}px; width: ${SW}px; height: ${SH}px; z-index: 2; }
    #${id}-scr { position: absolute; inset: 0; border-radius: 54px; overflow: hidden; border: 10px solid #241c18; background: #f6f1ec;
      box-shadow: 0 34px 80px rgba(78, 47, 34, 0.3); }
    #${id}-zoom { position: absolute; inset: 0; }
    #${id}-zoom video, #${id}-zoom img.shot { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
    .tap { position: absolute; width: 78px; height: 78px; margin: -39px 0 0 -39px; border-radius: 50%; border: 7px solid #a8624a; opacity: 0; }
    .dot { position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; background: rgba(168, 98, 74, 0.55); opacity: 0; }`;

const caption = (id, l1, l2, sub) => `
    <div id="${id}-cap">
      <span class="l" id="${id}-l1">${l1}</span>
      <span class="l" id="${id}-l2">${l2}</span>
      ${sub ? `<span class="sub" id="${id}-sub">${sub}</span>` : ""}
    </div>`;

// 録画の中のタップ位置（0〜1）に印を置く
const taps = (id, clip) =>
  clip.taps
    .map(
      (t, i) => `
        <div class="tap" id="${id}-tap${i}" style="left:${(t.x * 100).toFixed(2)}%;top:${(t.y * 100).toFixed(2)}%"></div>
        <div class="dot" id="${id}-dot${i}" style="left:${(t.x * 100).toFixed(2)}%;top:${(t.y * 100).toFixed(2)}%"></div>`,
    )
    .join("");
const tapTweens = (id, clip, offset = 0) =>
  clip.taps
    .map(
      (t, i) => `
      tl.fromTo("#${id}-tap${i}", { scale: 0.4, opacity: 0.9 }, { scale: 1.6, opacity: 0, duration: 0.47, ease: "power2.out" }, ${(offset + t.t).toFixed(2)});
      tl.fromTo("#${id}-dot${i}", { opacity: 0 }, { opacity: 1, duration: 0.05 }, ${(offset + t.t).toFixed(2)});
      tl.to("#${id}-dot${i}", { opacity: 0, duration: 0.15 }, ${(offset + t.t + 0.2).toFixed(2)});`,
    )
    .join("");

// 見出しの入り（行ごとに4フレームずらして下から）と、場面の終わりの退場
const capIn = (id, at, sub) => `
      tl.fromTo(["#${id}-l1", "#${id}-l2"${sub ? `, "#${id}-sub"` : ""}], { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.47, ease: "power3.out", stagger: 0.13 }, ${at});`;
const capOut = (id, at, sub) => `
      tl.fromTo(["#${id}-l1", "#${id}-l2"${sub ? `, "#${id}-sub"` : ""}], { opacity: 1 }, { opacity: 0, duration: 0.33, ease: "power2.in", immediateRender: false }, ${at});`;
const camIn = (id) => `
      tl.fromTo("#${id}-cam", { x: ${W} }, { x: 0, duration: 0.53, ease: "power2.inOut" }, 0);`;
const camOut = (id, at) => `
      tl.fromTo("#${id}-cam", { x: 0 }, { x: ${-W}, duration: 0.4, ease: "power2.in", immediateRender: false }, ${at});`;
// 画面の中を寄る（拡大の中心は録画の中の位置 0〜1）
const punch = (id, at, scale, ox, oy, dur = 0.6) => `
      tl.fromTo("#${id}-zoom", { scale: 1 }, { scale: ${scale}, transformOrigin: "${(ox * 100).toFixed(1)}% ${(oy * 100).toFixed(1)}%", duration: ${dur}, ease: "power2.inOut" }, ${at});`;

function scene(id, dur, body, script) {
  return `<template>
  <style>${baseCss(id)}
  </style>
  <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">${body}
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });${script}
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
`;
}
const screen = (id, src, clip, extra = "") => `
    <div id="${id}-cam" data-layout-allow-overflow>
      <div id="${id}-scr">
        <div id="${id}-zoom">
          <video id="${id}-video" class="clip" data-start="0" data-duration="${SCENES.find((s) => s.id === id).dur}" data-track-index="1" src="assets/${src}" muted playsinline></video>${clip ? taps(id, clip) : ""}${extra}
        </div>
      </div>
    </div>`;

// ---- 1. 散らかりがちなPDFを、ぜんぶここで整理 ----
const chipList = phone
  ? [
      ["pattern_final(2).pdf", 30, 470, -8],
      ["ミトン 日本語訳.pdf", 420, 640, 7],
      ["IMG_2048.PNG", 60, 900, 6, true],
      ["cardigan_ENG_v3.pdf", 330, 1150, -6],
      ["新しいパターン (1).pdf", 40, 1420, -4],
      ["chart_scan.png", 470, 1640, 8, true],
    ]
  : [
      ["pattern_final(2).pdf", 40, 360, -8],
      ["ミトン 日本語訳.pdf", 640, 470, 7],
      ["IMG_2048.PNG", 70, 720, 6, true],
      ["cardigan_ENG_v3.pdf", 600, 930, -6],
      ["新しいパターン (1).pdf", 60, 1170, -4],
      ["chart_scan.png", 700, 1330, 8, true],
    ];
const chipCss = `
    .chip { position: absolute; display: flex; align-items: center; gap: 16px; background: #fffdfa; border-radius: 22px; padding: 16px 26px 16px 16px;
      box-shadow: 0 18px 40px rgba(80, 50, 30, 0.22); white-space: nowrap; z-index: 4; }
    .chip i { display: inline-flex; align-items: center; justify-content: center; width: ${phone ? 64 : 84}px; height: ${phone ? 72 : 94}px; border-radius: 10px; color: #fff;
      font-style: normal; font-weight: 900; font-size: ${phone ? 24 : 32}px; letter-spacing: 0; background: #c0503a; }
    .chip i.img { background: #6f8fb4; }
    .chip b { color: #4e2f22; font-weight: 700; font-size: ${phone ? 30 : 36}px; }`;
const camCx = SX + SW / 2;
const camCy = SY + SH * 0.3;
const s1 = scene(
  "s1",
  5,
  `${caption("s1", "散らかる<em>編み図PDF</em>、", "ぜんぶここで整理。")}
    <style>${chipCss}</style>${screen("s1", "library.mp4", clips.library)}
    ${chipList
      .map(
        ([name, x, y, r, img], i) =>
          `<div class="chip" id="s1-chip${i}" style="left:${x}px;top:${y}px;transform:rotate(${r}deg)"><i class="${img ? "img" : ""}">${img ? "IMG" : "PDF"}</i><b>${name}</b></div>`,
      )
      .join("\n    ")}`,
  `${chipList
    .map(
      ([, x, y, r], i) => `
      tl.fromTo("#s1-chip${i}", { x: 0, y: 0, rotation: ${r}, scale: 1, opacity: 1 },
        { x: ${Math.round(camCx - (x + 200))}, y: ${Math.round(camCy - (y + 50))}, rotation: 0, scale: 0.12, opacity: 0, duration: 0.5, ease: "power2.in" }, ${(1.0 + i * 0.1).toFixed(2)});`,
    )
    .join("")}${camOut("s1", 4.6)}${capOut("s1", 4.6)}`,
);

// ---- 2. PDFは何枚でも、まとめて登録 ----
const s2 = scene(
  "s2",
  5.4,
  `${caption("s2", "PDFは何枚でも、", "<em>まとめて登録</em>", "ファイル名から種類を自動で仕分け")}${screen("s2", "bulk.mp4", clips.bulk)}`,
  `${camIn("s2")}${capIn("s2", 0.1, true)}${tapTweens("s2", clips.bulk)}${(phone ? punch("s2", 2.6, 1.18, 0.02, 0.3) : "")}${camOut("s2", 5.0)}${capOut("s2", 5.0, true)}`,
);

// ---- 3. これ持ってる？ ----
const s3 = scene(
  "s3",
  5.4,
  `${caption("s3", "「<em>これ持ってる？</em>」", "本屋さんですぐ確認", "バーコードをかざすだけ。二重買いを防げる")}${screen("s3", "check.mp4", clips.check)}`,
  `${camIn("s3")}${capIn("s3", 0.1, true)}${tapTweens("s3", clips.check)}${punch("s3", 2.5, phone ? 1.25 : 1.15, 0.02, phone ? 0.27 : 0.22)}${camOut("s3", 5.0)}${capOut("s3", 5.0, true)}`,
);

// ---- 4. 定規と段数カウンター ----
const s4 = scene(
  "s4",
  4.4,
  `${caption("s4", "今編んでいる段が、", "<em>ひと目でわかる</em>", "定規と段数カウンターが連動")}${screen("s4", "ruler.mp4", clips.ruler)}`,
  `${camIn("s4")}${capIn("s4", 0.1, true)}
      tl.fromTo("#s4-zoom", { scale: ${phone ? 1.12 : 1} }, { scale: ${phone ? 1.12 : 1}, transformOrigin: "35% ${phone ? 42 : 40}%", duration: 0.01 }, 0);${tapTweens("s4", clips.ruler)}${capOut("s4", 4.05, true)}`,
);

// ---- 5. 締め：画面がアイコンに縮み、アプリ名が出る ----
const ICON = phone ? 300 : 280;
const iconTop = phone ? 640 : 470;
const s5 = scene(
  "s5",
  4.3,
  `
    <style>
      #s5-icon { position: absolute; left: ${(W - ICON) / 2}px; top: ${iconTop}px; width: ${ICON}px; height: ${ICON}px; border-radius: ${Math.round(ICON * 0.225)}px;
        box-shadow: 0 28px 60px rgba(78, 47, 34, 0.28); z-index: 3; }
      #s5-name { position: absolute; left: 0; right: 0; top: ${iconTop + ICON + 70}px; text-align: center; font-weight: 900; font-size: ${phone ? 70 : 72}px;
        color: #4e2f22; letter-spacing: 0.04em; }
      #s5-tag { position: absolute; left: 0; right: 0; top: ${iconTop + ICON + 190}px; text-align: center; font-weight: 700; font-size: ${phone ? 34 : 36}px; color: #8e5a44; }
    </style>
    <div id="s5-cam" data-layout-allow-overflow>
      <div id="s5-scr">
        <div id="s5-zoom"><img class="shot" id="s5-last" src="assets/ruler-last.png" alt="" /></div>
      </div>
    </div>
    <img id="s5-icon" src="assets/icon.png" alt="" />
    <div id="s5-name">編み図ライブラリ</div>
    <div id="s5-tag">編み図PDF管理と段数カウンターをひとつに</div>`,
  `
      tl.fromTo("#s5-zoom", { scale: ${phone ? 1.12 : 1} }, { scale: ${phone ? 1.12 : 1}, transformOrigin: "35% ${phone ? 42 : 40}%", duration: 0.01 }, 0);
      tl.fromTo("#s5-cam", { x: 0, y: 0, scale: 1 },
        { x: 0, y: ${Math.round(iconTop + ICON / 2 - (SY + SH / 2))}, scale: ${(ICON / SW).toFixed(3)}, duration: 0.6, ease: "power2.inOut" }, 0.1);
      tl.fromTo("#s5-scr", { borderRadius: 54 }, { borderRadius: ${Math.round((ICON * 0.225 * SW) / ICON)}, duration: 0.6, ease: "power2.inOut" }, 0.1);
      tl.fromTo("#s5-cam", { opacity: 1 }, { opacity: 0, duration: 0.2, immediateRender: false }, 0.62);
      tl.fromTo("#s5-icon", { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(1.6)" }, 0.55);
      tl.fromTo("#s5-name", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.47, ease: "power3.out" }, 0.95);
      tl.fromTo("#s5-tag", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.47, ease: "power3.out" }, 1.08);`,
);

mkdirSync(join(OUT, "compositions"), { recursive: true });
for (const [id, html] of Object.entries({ s1, s2, s3, s4, s5 })) writeFileSync(join(OUT, "compositions", `${id}.html`), html);

const index = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #f3e4d9; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="${W}" data-height="${H}">
${SCENES.map(
  (s, i) => `      <div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.dur}"
        data-track-index="${i + 1}" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`,
).join("\n")}
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
writeFileSync(join(OUT, "index.html"), index);
if (!existsSync(join(OUT, "SPEC.md"))) writeFileSync(join(OUT, "SPEC.md"), readFileSync(join(ROOT, "film-iphone", "SPEC.md"), "utf8"));
console.log(`built ${OUT} (${W}x${H}, ${TOTAL}s)`);
