import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, normalizeForSearch, searchPatterns } from "./search";
import type { Category, Pattern, PatternFile } from "../db/types";

const p = (id: string, over: Partial<Pattern> = {}): Pattern => ({
  id,
  title: id,
  createdAt: 0,
  updatedAt: 0,
  status: "want",
  favorite: false,
  categoryIds: [],
  tags: [],
  ...over,
});
const f = (patternId: string, over: Partial<PatternFile> = {}): PatternFile => ({
  id: patternId + "-f",
  patternId,
  name: "x.pdf",
  kind: "original",
  mimeType: "application/pdf",
  size: 1,
  createdAt: 0,
  blobId: "b",
  ...over,
});

const patterns = [
  p("A", { title: "ラグランセーター", designer: "Anna", status: "in_progress", favorite: true, updatedAt: 3, tags: ["冬"] }),
  p("B", { title: "Cable Hat", shopName: "Ravelry", categoryIds: ["hat"], updatedAt: 1, lastOpenedAt: 10 }),
  p("C", { title: "靴下", notes: "かかとはフレンチヒール", status: "done", updatedAt: 2 }),
];
const files = [f("A", { kind: "translation" }), f("B")];
const cats: Category[] = [{ id: "hat", name: "帽子", order: 0, createdAt: 0 }];
const run = (q: Partial<typeof DEFAULT_QUERY>) =>
  searchPatterns(patterns, files, cats, { ...DEFAULT_QUERY, ...q }).map((x) => x.id);

describe("検索", () => {
  it("タイトル・デザイナー・ショップ・カテゴリ・タグ・メモを対象にする", () => {
    expect(run({ text: "anna" })).toEqual(["A"]);
    expect(run({ text: "ravelry" })).toEqual(["B"]);
    expect(run({ text: "帽子" })).toEqual(["B"]);
    expect(run({ text: "冬" })).toEqual(["A"]);
    expect(run({ text: "フレンチ" })).toEqual(["C"]);
  });
  it("カタカナ・ひらがな、全角・半角の違いを吸収する", () => {
    expect(run({ text: "らぐらん" })).toEqual(["A"]);
    expect(run({ text: "ＣＡＢＬＥ" })).toEqual(["B"]);
    expect(normalizeForSearch("ｾｰﾀｰ")).toBe(normalizeForSearch("せーたー"));
  });
  it("複数語はAND検索", () => {
    expect(run({ text: "cable 帽子" })).toEqual(["B"]);
    expect(run({ text: "cable 冬" })).toEqual([]);
  });
});

describe("絞り込み", () => {
  it("ステータス・お気に入り・PDF有無・カテゴリ・ファイル種別", () => {
    expect(run({ statuses: ["in_progress", "done"] })).toEqual(["A", "C"]);
    expect(run({ favoriteOnly: true })).toEqual(["A"]);
    expect(run({ hasPdf: true })).toEqual(["A", "B"]);
    expect(run({ hasPdf: false })).toEqual(["C"]);
    expect(run({ categoryId: "hat" })).toEqual(["B"]);
    expect(run({ fileKind: "translation" })).toEqual(["A"]);
  });
});

describe("並べ替え", () => {
  it("更新日時・タイトル・最終閲覧日時", () => {
    expect(run({ sort: "updatedAt", desc: true })).toEqual(["A", "C", "B"]);
    expect(run({ sort: "updatedAt", desc: false })).toEqual(["B", "C", "A"]);
    expect(run({ sort: "title", desc: false })[0]).toBe("B");
    // 未閲覧は並び順に関わらず末尾
    expect(run({ sort: "lastOpenedAt", desc: true })[0]).toBe("B");
    expect(run({ sort: "lastOpenedAt", desc: false })[0]).toBe("B");
  });
});
