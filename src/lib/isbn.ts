// ISBN（本の番号）の確認と変換。バーコード（EAN-13）・手入力のどちらにも使う。

function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidIsbn13(s: string): boolean {
  return /^97[89]\d{10}$/.test(s) && isbn13CheckDigit(s.slice(0, 12)) === Number(s[12]);
}

export function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

/** 入力（ハイフン・空白・全角を含んでもよい）を ISBN-13 の数字だけにする。正しくなければ undefined。 */
export function normalizeIsbn(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const s = input.normalize("NFKC").toUpperCase().replace(/[^0-9X]/g, "");
  if (s.length === 13) return isValidIsbn13(s) ? s : undefined;
  if (s.length === 10 && isValidIsbn10(s)) {
    const first12 = "978" + s.slice(0, 9);
    return first12 + isbn13CheckDigit(first12);
  }
  return undefined;
}

/** 表示用（978-xxxxxxxxxx） */
export function formatIsbn(isbn13: string): string {
  return /^\d{13}$/.test(isbn13) ? `${isbn13.slice(0, 3)}-${isbn13.slice(3)}` : isbn13;
}
