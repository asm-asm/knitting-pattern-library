// 購入先ページの HTML から作品情報を取り出す（通信は行わない純粋関数）。
// 一般的なサイトは JSON-LD（schema.org Product）と OGP、Ravelry は項目一覧から読み取る。
import { normalizeIsbn } from "./isbn";

export interface PageInfo {
  title?: string;
  designer?: string;
  shopName?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  yarn?: string;
  needles?: string;
  gauge?: string;
  size?: string;
  /** アプリのカテゴリ名の候補（例：「セーター」） */
  categoryHints: string[];
  // ---- 本・電子書籍のページ ----
  /** 著者（ブランド名は含めない） */
  author?: string;
  publisher?: string;
  /** ISBN-13（ページに載っていれば） */
  isbn?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rarr: "→", hellip: "…", lrm: "‎", rlm: "‏" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function text(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function clean(s: string | undefined, max = 200): string | undefined {
  const v = s?.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : undefined;
}

function metaContent(html: string, key: string): string | undefined {
  // property / name の順序や属性の並びが違っても拾えるようにする
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (k?.toLowerCase() !== key.toLowerCase()) continue;
    const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (c?.trim()) return decodeEntities(c.trim());
  }
  return undefined;
}

type Json = Record<string, unknown>;

function findProduct(html: string): Json | undefined {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const v = stack.pop();
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === "object") {
        const o = v as Json;
        const t = o["@type"];
        const types = Array.isArray(t) ? t : [t];
        if (types.includes("Product") || types.includes("Book")) return o;
        if (o["@graph"]) stack.push(o["@graph"]);
      }
    }
  }
  return undefined;
}

const nameOf = (v: unknown): string | undefined =>
  typeof v === "string" ? v : Array.isArray(v) ? nameOf(v[0]) : v && typeof v === "object" ? nameOf((v as Json).name) : undefined;
const firstStr = (v: unknown): string | undefined =>
  typeof v === "string" ? v : Array.isArray(v) ? firstStr(v[0]) : v && typeof v === "object" ? firstStr((v as Json).url) : undefined;

/** 英語のカテゴリ名から、アプリの基本カテゴリ名を推測する */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/cardigan/i, "カーディガン"],
  [/vest|tank|sleeveless/i, "ベスト"],
  [/sweater|pullover|jumper/i, "セーター"],
  [/hat|beanie|beret|cap\b/i, "帽子"],
  [/shawl|wrap|stole/i, "ショール"],
  [/sock/i, "靴下"],
  [/mitten|glove|scarf|cowl|bag|toy|softies/i, "小物"],
];

export function categoryHintsFrom(s: string | undefined): string[] {
  if (!s) return [];
  // 「Sweater → Cardigan」のように細かい分類があれば、そちらを優先する
  const parts = s.split(/→|>|\//).map((p) => p.trim()).reverse();
  for (const p of parts) for (const [re, name] of CATEGORY_WORDS) if (re.test(p)) return [name];
  return [];
}

function ravelryFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<label class="core_item_content__label">([^<]+)<\/label>([\s\S]*?)<\/div>\s*<\/div>/g;
  for (const m of html.matchAll(re)) {
    // 一致範囲には最後の値の閉じタグが含まれないので補ってから取り出す（末尾の「?」はヘルプへのリンク）
    const body = m[2] + "</div>";
    const values = [...body.matchAll(/<div class="value">([\s\S]*?)<\/div>/g)].map((v) => text(v[1]).replace(/\s*\?$/, ""));
    out[m[1].trim()] = values.filter(Boolean).join(" / ");
  }
  return out;
}

export function extractPageInfo(html: string, pageUrl: string): PageInfo {
  const product = findProduct(html);
  let host = "";
  try {
    host = new URL(pageUrl).host.replace(/^www\./, "");
  } catch {
    /* 表示用のみ */
  }

  const offers = (Array.isArray(product?.offers) ? product?.offers[0] : product?.offers) as Json | undefined;
  const priceRaw = offers?.price ?? offers?.lowPrice ?? metaContent(html, "og:price:amount") ?? metaContent(html, "product:price:amount");
  const price = priceRaw === undefined || priceRaw === "" ? undefined : Number(String(priceRaw).replace(/,/g, ""));
  const currency = (offers?.priceCurrency as string | undefined) ?? metaContent(html, "og:price:currency") ?? metaContent(html, "product:price:currency");

  const ogTitle = metaContent(html, "og:title") ?? metaContent(html, "twitter:title");
  const docTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  // 「〇〇 pattern by デザイナー」（Ravelry など）
  const byMatch = /^(.*?)\s+pattern\s+by\s+(.+)$/i.exec(ogTitle ?? "");

  const info: PageInfo = {
    title: clean(nameOf(product?.name) ?? byMatch?.[1] ?? ogTitle ?? (docTitle ? text(docTitle) : undefined)),
    designer: clean(nameOf(product?.author) ?? nameOf(product?.brand) ?? byMatch?.[2]),
    // 「電子書籍ストア | BOOK☆WALKER」のような名前は、最後の部分（店名）だけにする
    shopName: clean(metaContent(html, "og:site_name")?.split(/\s*[|｜]\s*/).filter(Boolean).pop()) ?? (host || undefined),
    price: price !== undefined && Number.isFinite(price) && price >= 0 ? price : undefined,
    currency: clean(currency, 3)?.toUpperCase(),
    imageUrl: firstStr(product?.image) ?? metaContent(html, "og:image") ?? metaContent(html, "twitter:image"),
    categoryHints: [],
  };

  if (/(^|\.)ravelry\.com$/.test(host)) {
    const f = ravelryFields(html);
    const designerLink = /href="https:\/\/www\.ravelry\.com\/designers\/[^"]+">([^<]+)</.exec(html)?.[1];
    if (designerLink) info.designer = clean(decodeEntities(designerLink));
    info.yarn = clean([f["Yarn weight"], f["Yardage"]].filter(Boolean).join("・"));
    info.needles = clean(f["Needle size"]);
    info.gauge = clean(f["Gauge"]);
    info.size = clean(f["Sizes available"]);
    info.categoryHints = categoryHintsFrom(f["Category"]);
  } else {
    info.categoryHints = categoryHintsFrom(nameOf(product?.category) ?? info.title);
  }

  // ---- 本・電子書籍 ----
  const productTypes = Array.isArray(product?.["@type"]) ? (product?.["@type"] as string[]) : [product?.["@type"]];
  const isBookLd = productTypes.includes("Book");
  info.author = clean(nameOf(product?.author) ?? metaContent(html, "book:author") ?? metaContent(html, "author"));
  info.publisher = clean(nameOf(product?.publisher) ?? (isBookLd || /honto\.jp$/.test(host) ? nameOf(product?.brand) : undefined));
  const isbnRaw = [product?.isbn, product?.gtin13, product?.productID, metaContent(html, "book:isbn")].find((v) => typeof v === "string");
  info.isbn = normalizeIsbn(isbnRaw as string | undefined);

  if (/(^|\.)amazon\.(co\.jp|com)$/.test(host)) Object.assign(info, amazonInfo(html));

  if (info.imageUrl) {
    try {
      // 相対パスを絶対 URL にし、Ravelry の「#webp」などの断片は取り除く
      const u = new URL(info.imageUrl, pageUrl);
      u.hash = "";
      info.imageUrl = u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
    } catch {
      info.imageUrl = undefined;
    }
  }
  return info;
}

/**
 * Amazon（Kindle）の商品ページ。OGP や JSON-LD がないため、ページのタイトルなどから読み取る。
 * 例：「書名 | 著者 | 手芸 | Kindleストア | Amazon」
 *     「Amazon.co.jp: 書名 eBook : 著者: Kindleストア」
 */
export function amazonInfo(html: string): Partial<PageInfo> {
  const out: Partial<PageInfo> = { shopName: "Amazon" };
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? metaContent(html, "title") ?? "").trim());
  const old = /^Amazon\.co\.jp[:：]\s*(.+?)\s+eBook\s*[:：]\s*(.+?)\s*[:：]\s*Kindle/.exec(title);
  if (old) {
    out.title = clean(old[1]);
    out.author = clean(old[2]);
  } else {
    const parts = title.split(/\s+\|\s+/);
    if (parts.length >= 3) {
      out.title = clean(parts[0]);
      if (!/Kindle|Amazon|ストア/.test(parts[1])) out.author = clean(parts[1]);
    }
  }
  // 出版社（商品の詳細欄）
  const i = html.indexOf("出版社");
  if (i >= 0) {
    const t = text(html.slice(i, i + 400)).replace(/[\u200e\u200f]/g, "");
    const m = /出版社\s*[:：]?\s*([^\s(（:：][^(（]*?)\s*(?:[（(]|発売|言語|$)/.exec(t);
    if (m) out.publisher = clean(m[1]);
  }
  // 表紙画像：一番大きいもの、なければ商品画像
  const big = /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9%+_.-]+?\._SL1[0-9]{3}_\.jpg/.exec(html)?.[0];
  const product = /&quot;productImage&quot;:&quot;(https:\/\/m\.media-amazon\.com\/images\/I\/[^&]+)&quot;/.exec(html)?.[1];
  const img = big ?? product;
  if (img) out.imageUrl = img;
  return out;
}
