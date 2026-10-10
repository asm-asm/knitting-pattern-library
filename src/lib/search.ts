// 端末内で完結する検索・絞り込み・並べ替え（ネットワーク通信なし）
import type { Category, FileKind, Pattern, PatternFile, PatternStatus, ItemType } from "../db/types";
import { itemTypeOf } from "../db/types";

export type SortKey = "createdAt" | "updatedAt" | "title" | "lastOpenedAt";

export const SORT_LABELS: Record<SortKey, string> = {
  updatedAt: "更新日時",
  createdAt: "登録日時",
  title: "タイトル",
  lastOpenedAt: "最終閲覧日時",
};

export interface LibraryQuery {
  text: string;
  statuses: PatternStatus[];
  favoriteOnly: boolean;
  /** true: PDFあり / false: PDFなし / undefined: 指定なし */
  hasPdf?: boolean;
  categoryId?: string;
  fileKind?: FileKind;
  /** 種類（未指定＝すべて） */
  itemType?: ItemType;
  sort: SortKey;
  desc: boolean;
}

export const DEFAULT_QUERY: LibraryQuery = {
  text: "",
  statuses: [],
  favoriteOnly: false,
  sort: "updatedAt",
  desc: true,
};

/** 全角半角・大文字小文字・カタカナひらがなの違いを吸収する */
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function searchPatterns(
  patterns: Pattern[],
  files: PatternFile[],
  categories: Category[],
  q: LibraryQuery,
): Pattern[] {
  const filesByPattern = new Map<string, PatternFile[]>();
  for (const f of files) {
    const list = filesByPattern.get(f.patternId);
    if (list) list.push(f);
    else filesByPattern.set(f.patternId, [f]);
  }
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const terms = normalizeForSearch(q.text).split(/\s+/).filter(Boolean);

  const result = patterns.filter((p) => {
    const pf = filesByPattern.get(p.id) ?? [];
    if (q.statuses.length && !q.statuses.includes(p.status)) return false;
    if (q.favoriteOnly && !p.favorite) return false;
    if (q.hasPdf !== undefined && pf.some((f) => f.mimeType === "application/pdf") !== q.hasPdf) return false;
    if (q.categoryId && !p.categoryIds.includes(q.categoryId)) return false;
    if (q.fileKind && !pf.some((f) => f.kind === q.fileKind)) return false;
    if (q.itemType && itemTypeOf(p) !== q.itemType) return false;
    if (terms.length) {
      const haystack = normalizeForSearch(
        [
          p.title,
          p.designer,
          p.shopName,
          p.notes,
          p.author,
          p.publisher,
          p.isbn,
          ...p.tags,
          ...p.categoryIds.map((id) => catName.get(id) ?? ""),
        ]
          .filter(Boolean)
          .join("\n"),
      );
      if (!terms.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });

  const dir = q.desc ? -1 : 1;
  const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  result.sort((a, b) => {
    let c: number;
    if (q.sort === "title") c = collator.compare(a.title, b.title);
    else {
      // 未閲覧（値なし）は並び順に関わらず末尾へ
      const av = a[q.sort];
      const bv = b[q.sort];
      if (av === undefined && bv === undefined) c = 0;
      else if (av === undefined) return 1;
      else if (bv === undefined) return -1;
      else c = av - bv;
    }
    return c * dir || collator.compare(a.title, b.title);
  });
  return result;
}
