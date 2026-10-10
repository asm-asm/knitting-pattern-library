import { describe, expect, it } from "vitest";
import { categoryHintsFrom, extractPageInfo } from "./urlInfo";

// Ravelry のパターンページと同じ構造の最小サンプル
const ravelry = `
<html><head>
<title>Ravelry: Flax sock pattern by tincanknits</title>
<meta content="Flax sock pattern by tincanknits" property="og:title">
<meta content="Ravelry" property="og:site_name">
<meta content="https://images4-g.ravelrycache.com/uploads/x/flax_small2.jpg#webp" property="og:image">
<script type="application/ld+json">{"@context":"https://schema.org/","@type":"Product","name":"Flax sock","image":["https://images4-g.ravelrycache.com/uploads/x/flax_medium.jpg"],"brand":{"@type":"Brand","name":"tincanknits"},"offers":{"@type":"Offer","priceCurrency":"USD","price":7.5}}</script>
</head><body>
<a href="https://www.ravelry.com/designers/tin-can-knits">Tin Can Knits</a>
<div class="field core_item_content__field"> <label class="core_item_content__label">Category</label> <div class="value"> Sweater &rarr; Cardigan </div> </div>
<div class="field core_item_content__field"> <label class="core_item_content__label">Yarn weight</label> <div class="value"> Fingering (14 wpi) <a href="#">?</a> </div> </div>
<div class="field core_item_content__field"> <label class="core_item_content__label">Gauge</label> <div class="value"> 24 stitches and 32 rows = 10 cm<br class='rsp_hidden'/> in stockinette </div> </div>
<div class="field core_item_content__field"> <label class="core_item_content__label">Needle size</label> <div class="value">US 2 - 2.75 mm</div> <div class="value">US 5 - 3.75 mm</div> </div>
<div class="field core_item_content__field"> <label class="core_item_content__label">Yardage</label> <div class="value"> 300 - 2800 yards (274 - 2560 m) </div> </div>
<div class="field core_item_content__field"> <label class="core_item_content__label">Sizes available</label> <div class="value"> XS (S, M, L) </div> </div>
</body></html>`;

describe("URL からの作品情報の抽出", () => {
  it("Ravelry のパターンページ", () => {
    const info = extractPageInfo(ravelry, "https://www.ravelry.com/patterns/library/flax-light");
    expect(info).toEqual({
      title: "Flax sock",
      designer: "Tin Can Knits",
      shopName: "Ravelry",
      price: 7.5,
      currency: "USD",
      imageUrl: "https://images4-g.ravelrycache.com/uploads/x/flax_medium.jpg",
      yarn: "Fingering (14 wpi)・300 - 2800 yards (274 - 2560 m)",
      needles: "US 2 - 2.75 mm / US 5 - 3.75 mm",
      gauge: "24 stitches and 32 rows = 10 cm in stockinette",
      size: "XS (S, M, L)",
      categoryHints: ["カーディガン"],
    });
  });

  it("一般的なショップ（OGP のみ）", () => {
    const html = `<head>
      <meta property="og:title" content="Mohair Beret &amp; Scarf Set">
      <meta property="og:site_name" content="Example Yarn Shop">
      <meta property="og:image" content="/img/beret.jpg">
      <meta property="product:price:amount" content="1,980">
      <meta property="product:price:currency" content="jpy">
    </head>`;
    expect(extractPageInfo(html, "https://shop.example.com/items/1")).toMatchObject({
      title: "Mohair Beret & Scarf Set",
      shopName: "Example Yarn Shop",
      imageUrl: "https://shop.example.com/img/beret.jpg",
      price: 1980,
      currency: "JPY",
      categoryHints: ["帽子"],
    });
  });

  it("情報がないページでもタイトルとショップ名は補える", () => {
    expect(extractPageInfo("<title>  かぎ針の編み図 </title>", "https://www.example.jp/p")).toMatchObject({
      title: "かぎ針の編み図",
      shopName: "example.jp",
      price: undefined,
      imageUrl: undefined,
    });
  });

  it("危険な画像 URL は使わない", () => {
    const html = `<meta property="og:image" content="javascript:alert(1)">`;
    expect(extractPageInfo(html, "https://example.com").imageUrl).toBeUndefined();
  });

  it("カテゴリの推測", () => {
    expect(categoryHintsFrom("Sweater → Pullover")).toEqual(["セーター"]);
    expect(categoryHintsFrom("Accessories → Hat → Beanie, Toque")).toEqual(["帽子"]);
    expect(categoryHintsFrom("Neck / Torso → Shawl / Wrap")).toEqual(["ショール"]);
    expect(categoryHintsFrom("Home → Blanket")).toEqual([]);
  });
});
