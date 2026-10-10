// 「これ持ってる？」：ISBN や書名から、登録済みの本・作品を探す（端末内で完結）
import type { Pattern } from "../db/types";
import { normalizeForSearch } from "./search";

export interface OwnershipResult {
  /** ISBN が一致した本 */
  exact: Pattern[];
  /** 書名が似ている本・作品（ISBN が登録されていないものなど） */
  similar: Pattern[];
}

/** 比べやすい形にする（記号・空白・括弧の中の補足を除く） */
export function titleKey(s: string): string {
  return normalizeForSearch(s)
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** 0〜1 の似ている度合い（2文字ずつの組の重なり） */
export function titleSimilarity(a: string, b: string): number {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // 片方がもう片方を含む（「北欧ニット」と「はじめての北欧ニット」など）
  if ((x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))) return 0.9;
  const bx = bigrams(x);
  const by = bigrams(y);
  if (!bx.length || !by.length) return 0;
  const pool = [...by];
  let hit = 0;
  for (const g of bx) {
    const i = pool.indexOf(g);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1);
    }
  }
  return (2 * hit) / (bx.length + by.length);
}

export const SIMILAR_THRESHOLD = 0.6;

export function findOwned(items: Pattern[], q: { isbn?: string; title?: string }): OwnershipResult {
  const exact = q.isbn ? items.filter((p) => p.isbn === q.isbn) : [];
  const exactIds = new Set(exact.map((p) => p.id));
  const similar = q.title
    ? items
        .filter((p) => !exactIds.has(p.id))
        .map((p) => ({ p, score: titleSimilarity(q.title!, p.title) }))
        .filter((x) => x.score >= SIMILAR_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.p)
    : [];
  return { exact, similar };
}
