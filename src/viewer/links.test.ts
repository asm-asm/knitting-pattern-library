import { describe, expect, it } from "vitest";
import { extractLinks, isOpenableUrl } from "./links";

// 倍率1・回転なしのビューポート（PDF は左下が原点、画面は左上が原点）
const viewport = { width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] };

describe("PDF 内のリンク", () => {
  it("リンクの位置をページに対する割合で返す", () => {
    const [l] = extractLinks([{ subtype: "Link", rect: [60, 700, 360, 780], url: "https://example.com/" }], viewport);
    expect(l.x).toBeCloseTo(0.1);
    expect(l.y).toBeCloseTo(0.025);
    expect(l.w).toBeCloseTo(0.5);
    expect(l.h).toBeCloseTo(0.1);
    expect(l.target).toEqual({ kind: "url", url: "https://example.com/" });
  });

  it("ページ内リンクと名前付きの移動を区別する", () => {
    const links = extractLinks(
      [
        { subtype: "Link", rect: [0, 0, 10, 10], dest: "chapter2" },
        { subtype: "Link", rect: [0, 0, 10, 10], action: "NextPage" },
      ],
      viewport,
    );
    expect(links.map((l) => l.target.kind)).toEqual(["dest", "named"]);
  });

  it("リンク以外の注釈や、開けない URL・大きさのないリンクは無視する", () => {
    const links = extractLinks(
      [
        { subtype: "Text", rect: [0, 0, 10, 10] },
        { subtype: "Link", rect: [0, 0, 10, 10], url: "javascript:alert(1)" },
        { subtype: "Link", rect: [5, 5, 5, 5], url: "https://example.com/" },
        { subtype: "Link", rect: [0, 0, 10, 10] },
      ],
      viewport,
    );
    expect(links).toEqual([]);
  });

  it("開いてよい URL は Web とメールだけ", () => {
    expect(isOpenableUrl("https://example.com")).toBe(true);
    expect(isOpenableUrl("mailto:a@example.com")).toBe(true);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("file:///etc/passwd")).toBe(false);
    expect(isOpenableUrl("not a url")).toBe(false);
  });
});
