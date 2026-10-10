import type { FileKind } from "../db/types";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(ms: number | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(ms: number | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const CURRENCIES = ["JPY", "USD", "EUR", "GBP", "CAD", "AUD", "DKK", "NOK", "SEK"];

export function formatPrice(price: number | undefined, currency = "JPY"): string {
  if (price === undefined) return "";
  try {
    return new Intl.NumberFormat("ja-JP", { style: "currency", currency }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

/** ファイル名から種別を推測する（登録時の初期値。利用者が変更できる） */
export function guessFileKind(name: string): FileKind {
  const n = name.toLowerCase();
  if (/日本語|和訳|翻訳|japanese|[_\-\s(（]jp[n]?[_\-\s.)）]|[_\-\s(（]ja[_\-\s.)）]/.test(n)) return "translation";
  if (/修正|訂正|改訂|errata|revised|[_\-\s]rev|v\d/.test(n)) return "revised";
  if (/chart|チャート|記号図|編み図/.test(n)) return "chart";
  if (/^image\//.test(n)) return "chart";
  return "original";
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
