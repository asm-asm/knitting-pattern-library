# 編み図ライブラリ App Store プレビュー（iPad）

GOAL:    In the first 2 seconds, someone who has ever lost a pattern PDF thinks "that's me". By the end they want the app that tidies their PDFs, registers many at once, and tells them in the bookstore whether they already own a book.
OUTPUT:  HyperFrames, 1200 x 1600, 30 fps (App Store app preview for iPad 13")
TIME:    24.5 s x 30 = 735 frames. No music yet (no source available, see the reply); a silent stereo track is added at the end.
LOOK:    Ground: #f6e9df → #efdcd0 vertical gradient plus a knit V-stitch tile (44 px, stroke rgba(168,98,74,0.07)). Same as the store screenshots.
         Ink: #4e2f22. Accent: #a8624a, only on the one word per caption that carries the point and on tap rings.
         Display face: Noto Sans JP 900, 58 px, tracking 0.02em, line-height 1.28. Sub line: Noto Sans JP 700, 32 px, #8e5a44.
         Medium: real app screen recordings (store/preview/footage) inside a rounded screen of 760 x 1647, radius 54, frame 10 px #241c18,
         shadow 0 34px 80px rgba(78,47,34,0.30). No device bezel drawing beyond that frame, no 3D tilt.
OBJECTS: The app's own screens (library of knitted works, the multi-file registration form, 「これ持ってる？」 result, the chart with the ruler).
         Messy filename cards: white #fffdfa cards, radius 22, a 58 x 68 red #c0503a "PDF" tile (blue #6f8fb4 "IMG"), name in 30 px 700.
         App icon from resources/icon-1024.png (the real icon, never redrawn).
MOTION:  enter = power3.out 14 frames; move/camera = power2.inOut 16 frames; exit = power2.in 10 frames; punch-in scale 1.0 → 1.32 over 18 frames.
         Tap ring: a 70 px ring scales 0.4 → 1.6 while fading 0.9 → 0 over 14 frames, plus a 26 px dot that holds 6 frames.
         Caption lines enter by line, 4-frame stagger, a 40 px rise; they never move while being read.
SHOTS:
  1  0.0–5.0   Hook. Frame 0 already shows the title 「散らかる編み図PDF、ぜんぶここで整理。」 and six messy filename cards scattered over the screen.
               At 1.0 s the cards fly into the screen and shrink to nothing (stagger 3 frames), the library recording scrolls. Reads: the title (held all 5 s).
               Hands off: the screen slides left out of frame on a 12-frame push.
  2  5.0–10.4  「PDFは何枚でも、まとめて登録」 / 「ファイル名から種類を自動で仕分け」. Recording bulk: tap on 「＋ PDF・画像を選ぶ」 at +1.04 s,
               four files appear. At +2.6 s punch-in to 1.18 from the left edge on the file list so the four kinds (英語原本・日本語翻訳版・編み図チャート・修正版) read. Hold.
  3  10.4–15.8 「「これ持ってる？」本屋さんですぐ確認」 / 「バーコードをかざすだけ。二重買いを防げる」. Recording check: tap on 「バーコードで調べる」 at +1.0 s,
               the result 「持っています」 lands ~+2.1 s; punch-in 1.25 from the left edge on the verdict and the book row at +2.5 s. Hold.
  4  15.8–20.2 「今編んでいる段が、ひと目でわかる」 / 「定規と段数カウンターが連動」. Recording ruler, pre-framed at 1.12 on the chart and counter.
               Two taps on the counter's ＋ move the ruler up a row each time.
  5  20.2–24.5 End card. The screen shrinks into the app icon's rounded square (container morph, 18 frames), the icon settles at 300 px,
               then 「編み図ライブラリ」 (64 px 900) and 「編み図PDF管理と段数カウンターをひとつに」 (32 px 700) rise in. Held 2.2 s.
BANNED:  dark void grounds, glow, particles, purple/blue gradients, glass cards, three cards in a row, a title over a dimmed screenshot,
         the logo docked in a corner, text moving while read, any price or 「無料」, any invented UI (no fake camera viewfinder), device frames drawn in 3D.
QA:      0.0 s (hook already readable), 2.0 s (cards gone, library visible), 8.2 s (four kinds readable), 13.4 s (持っています readable),
         18.0 s (ruler + counter), 23.5 s (end card complete).
