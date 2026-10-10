// 購入先ページと表紙画像の取得。利用者が URL を入力したときだけ通信する。
// ブラウザ版は他サイトの読み込みが制限（CORS）されるため、iOS アプリ版でのみ取得できる。
import { CapacitorHttp } from "@capacitor/core";
import { UserFacingError, normalizeUrl } from "../db/repo";
import { isNativeApp } from "./native";
import { extractPageInfo, type PageInfo } from "./urlInfo";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function canFetchUrlInfo(): boolean {
  return isNativeApp();
}

export async function fetchPageInfo(rawUrl: string): Promise<PageInfo> {
  if (!canFetchUrlInfo()) {
    throw new UserFacingError("ブラウザ版ではURLから情報を読み込めません。iPhone・iPad のアプリ版で読み込むか、手入力してください。");
  }
  if (!navigator.onLine) throw new UserFacingError("オフラインのため、URLから情報を読み込めません。接続後にもう一度お試しください。");
  const url = normalizeUrl(rawUrl)!;
  let res;
  try {
    res = await CapacitorHttp.get({
      url,
      responseType: "text",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "ja,en;q=0.8" },
      connectTimeout: 15000,
      readTimeout: 20000,
    });
  } catch {
    throw new UserFacingError("ページを読み込めませんでした。URLが正しいか、インターネットに接続しているか確認してください。");
  }
  if (res.status >= 400) {
    throw new UserFacingError(`ページを読み込めませんでした（エラー ${res.status}）。URLが正しいか確認してください。`);
  }
  const html = typeof res.data === "string" ? res.data : "";
  return extractPageInfo(html, res.url || url);
}

/** 表紙画像をダウンロードする（画像以外・大きすぎるものは使わない） */
export async function fetchImage(url: string): Promise<File | undefined> {
  if (!canFetchUrlInfo()) return undefined;
  try {
    const res = await CapacitorHttp.get({ url, responseType: "blob", headers: { "User-Agent": UA }, connectTimeout: 15000, readTimeout: 30000 });
    if (res.status >= 400 || typeof res.data !== "string") return undefined;
    const type = (Object.entries(res.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "").split(";")[0].trim();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return undefined;
    const bin = atob(res.data);
    if (bin.length > MAX_IMAGE_BYTES) return undefined;
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new File([bytes], "cover." + type.split("/")[1], { type });
  } catch {
    return undefined;
  }
}
