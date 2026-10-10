import { describe, expect, it } from "vitest";
import { findOwned, titleKey, titleSimilarity } from "./ownership";
import type { Pattern } from "../db/types";

const p = (id: string, title: string, over: Partial<Pattern> = {}): Pattern => ({
  id,
  title,
  createdAt: 0,
  updatedAt: 0,
  status: "want",
  favorite: false,
  categoryIds: [],
  tags: [],
  itemType: "book",
  ...over,
});

const items = [
  p("a", "はじめての北欧ニット", { isbn: "9780306406157" }),
  p("b", "毎日着たい手編みのニット"),
  p("c", "透かし模様のショールと小物", { itemType: "ebook" }),
  p("d", "北欧柄のミトン", { itemType: undefined }),
];

describe("これ持ってる？", () => {
  it("ISBN が一致すれば「持っている」", () => {
    expect(findOwned(items, { isbn: "9780306406157" }).exact.map((x) => x.id)).toEqual(["a"]);
    expect(findOwned(items, { isbn: "9784529058834" }).exact).toEqual([]);
  });

  it("ISBN が登録されていない本は、書名が似ていれば候補に出す", () => {
    const r = findOwned(items, { isbn: "9784000000000", title: "毎日着たい 手編みのニット（新装版）" });
    expect(r.exact).toEqual([]);
    expect(r.similar.map((x) => x.id)).toEqual(["b"]);
  });

  it("ISBN が一致した本は「似ている」には重ねて出さない", () => {
    const r = findOwned(items, { isbn: "9780306406157", title: "はじめての北欧ニット" });
    expect(r.exact.map((x) => x.id)).toEqual(["a"]);
    expect(r.similar.map((x) => x.id)).not.toContain("a");
  });

  it("関係ない本は候補に出さない", () => {
    expect(findOwned(items, { title: "かぎ針で編むあみぐるみ" }).similar).toEqual([]);
  });

  it("書名の比べ方", () => {
    expect(titleKey("ＮＥＷ　北欧ニット（第2版）")).toBe("new北欧にっと"); // カタカナはひらがなに揃える
    expect(titleSimilarity("北欧ニット", "はじめての北欧ニット")).toBeGreaterThanOrEqual(0.9);
    expect(titleSimilarity("透かし模様のショール", "透かし模様のショールと小物")).toBeGreaterThanOrEqual(0.6);
    expect(titleSimilarity("セーター", "靴下")).toBeLessThan(0.6);
  });
});
