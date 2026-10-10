// ISBN から本の情報（書名・著者・出版社・表紙）を調べる。
// 日本の本は openBD（公開の書誌データベース）、見つからなければ Google Books を使う。
// 利用者がバーコードを読み取ったとき・ISBN を入力して読み込みを押したときだけ通信する。
import { CapacitorHttp } from "@capacitor/core";
import { UserFacingError } from "../db/repo";
import { isNativeApp } from "./native";

export interface BookInfo {
  title?: string;
  author?: string;
  publisher?: string;
  coverUrl?: string;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * 著者名を読みやすくする。
 * 「山田花子／著 鈴木太郎／監修」→「山田花子、鈴木太郎」
 * 「宮沢,賢治,1896-1933」（姓,名,生没年）→「宮沢賢治」
 */
export function cleanAuthor(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const names = s
    .split(/[\s　、]+/)
    .map((n) => n.replace(/[／/](著|編|編著|作|文|絵|画|監修|訳|翻訳|写真|デザイン|作品制作|著者)$/, "").trim())
    .filter(Boolean)
    .map((n) => {
      if (!n.includes(",")) return n;
      const parts = n.split(",").map((p) => p.trim()).filter((p) => p && !/^\d{3,4}-?(\d{3,4})?$/.test(p));
      // 欧文は「名 姓」、和文は「姓名」に並べ直す
      return parts.every((p) => /^[\x20-\x7e]+$/.test(p)) ? [...parts].reverse().join(" ") : parts.join("");
    })
    .filter(Boolean);
  return names.length ? [...new Set(names)].join("、") : undefined;
}

export function parseOpenBD(json: unknown): BookInfo | undefined {
  const first = Array.isArray(json) ? (json[0] as Json | null) : null;
  const summary = first?.summary as Json | undefined;
  if (!summary) return undefined;
  const title = [str(summary.title), str(summary.volume)].filter(Boolean).join(" ");
  return {
    title: title || undefined,
    author: cleanAuthor(str(summary.author)),
    publisher: str(summary.publisher),
    coverUrl: str(summary.cover)?.replace(/^http:/, "https:"),
  };
}

export function parseGoogleBooks(json: unknown): BookInfo | undefined {
  const items = (json as Json | null)?.items;
  const info = Array.isArray(items) ? ((items[0] as Json)?.volumeInfo as Json | undefined) : undefined;
  if (!info) return undefined;
  const authors = Array.isArray(info.authors) ? info.authors.filter((a): a is string => typeof a === "string") : [];
  const images = info.imageLinks as Json | undefined;
  return {
    title: [str(info.title), str(info.subtitle)].filter(Boolean).join(" ") || undefined,
    author: authors.length ? authors.join("、") : undefined,
    publisher: str(info.publisher),
    coverUrl: (str(images?.thumbnail) ?? str(images?.smallThumbnail))?.replace(/^http:/, "https:"),
  };
}

async function getJson(url: string): Promise<unknown> {
  if (isNativeApp()) {
    const res = await CapacitorHttp.get({ url, responseType: "json", connectTimeout: 15000, readTimeout: 20000 });
    if (res.status >= 400) throw new Error(String(res.status));
    return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function lookupBook(isbn13: string): Promise<BookInfo | undefined> {
  if (!navigator.onLine) throw new UserFacingError("オフラインのため、本の情報を読み込めません。接続後にもう一度お試しください。");
  let failed = 0;
  try {
    const info = parseOpenBD(await getJson(`https://api.openbd.jp/v1/get?isbn=${isbn13}`));
    if (info?.title) return info;
  } catch {
    failed++;
  }
  try {
    const info = parseGoogleBooks(await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`));
    if (info?.title) return info;
  } catch {
    failed++;
  }
  if (failed === 2) throw new UserFacingError("本の情報を読み込めませんでした。インターネットに接続しているか確認してください。");
  return undefined;
}
