import { describe, expect, it } from "vitest";
import { anchorAt, computeLayout, pageIndexAt, renderRange, scrollForAnchor, TOP_PAD } from "./layout";
import { hitsInk, inkPath } from "./ink";
import { clampRuler, newRuler, resizeRuler, stepRuler } from "./ruler";

const A4 = { w: 595, h: 842 };

describe("ページ配置", () => {
  it("等倍では画面幅に収まり、ページは縦に並ぶ", () => {
    const l = computeLayout([A4, A4, A4], 400, 1);
    expect(l.contentWidth).toBe(400);
    expect(l.pages[0].width).toBeCloseTo(376);
    expect(l.pages[0].top).toBe(TOP_PAD);
    expect(l.pages[1].top).toBeGreaterThan(l.pages[0].top + l.pages[0].height);
  });

  it("拡大すると横にはみ出し、内容幅が広がる", () => {
    const l = computeLayout([A4], 400, 2);
    expect(l.pages[0].width).toBeCloseTo(752);
    expect(l.contentWidth).toBeCloseTo(776);
  });

  it("位置からページを求める", () => {
    const l = computeLayout([A4, A4, A4], 400, 1);
    expect(pageIndexAt(l, 0)).toBe(0);
    expect(pageIndexAt(l, l.pages[1].top + 1)).toBe(1);
    expect(pageIndexAt(l, 1e9)).toBe(2);
    expect(renderRange(l, l.pages[1].top, 500)).toEqual([0, 2]);
  });

  it("倍率や画面幅が変わっても同じ箇所を表示し続けられる", () => {
    const before = computeLayout([A4, A4, A4], 400, 1);
    const a = anchorAt(before, 0, before.pages[1].top + 100, 200, 300);
    // 倍率変更
    const zoomed = computeLayout([A4, A4, A4], 400, 2.5);
    const s = scrollForAnchor(zoomed, a, 200, 300);
    expect(anchorAt(zoomed, s.left, s.top, 200, 300)).toEqual(expect.objectContaining({ page: a.page }));
    expect(anchorAt(zoomed, s.left, s.top, 200, 300).fy).toBeCloseTo(a.fy);
    // 画面幅変更（端末の回転など）
    const wide = computeLayout([A4, A4, A4], 900, 1);
    const s2 = scrollForAnchor(wide, a, 200, 300);
    expect(anchorAt(wide, s2.left, s2.top, 200, 300).fy).toBeCloseTo(a.fy);
  });
});

describe("手書き線", () => {
  const aspect = A4.h / A4.w;
  it("線上の点は当たり、離れた点は当たらない", () => {
    const line = { points: [0.1, 0.5, 0.9, 0.5], width: 0.01 };
    expect(hitsInk(line, 0.5, 0.5, aspect)).toBe(true);
    expect(hitsInk(line, 0.5, 0.505, aspect)).toBe(true);
    expect(hitsInk(line, 0.5, 0.6, aspect)).toBe(false);
    expect(hitsInk({ points: [0.3, 0.3], width: 0.01 }, 0.3, 0.3, aspect)).toBe(true);
  });
  it("SVG パスはページ比率の座標系で出力される", () => {
    expect(inkPath([0, 0, 1, 1], aspect)).toBe(`M0.0 0.0L1000.0 ${(1000 * aspect).toFixed(1)}`);
  });
});


describe("編み図の定規", () => {
  it("次の段へ進むと帯の太さぶん上へ動き、前の段へ戻ると下へ動く", () => {
    const r = { page: 2, y: 0.5, height: 0.04, visible: true };
    expect(stepRuler(r, 1).y).toBeCloseTo(0.46);
    expect(stepRuler(r, -2).y).toBeCloseTo(0.58);
  });
  it("ページの上下からはみ出さない", () => {
    const r = { page: 1, y: 0.03, height: 0.04, visible: true };
    expect(stepRuler(r, 5).y).toBeCloseTo(0.02);
    expect(stepRuler({ ...r, y: 0.97 }, -5).y).toBeCloseTo(0.98);
  });
  it("太さを変えても中心は保ち、極端な太さにはならない", () => {
    const r = newRuler(1, 0.5);
    expect(resizeRuler(r, 1.25).y).toBeCloseTo(0.5);
    expect(resizeRuler(r, 100).height).toBe(0.25);
    expect(resizeRuler(r, 0.001).height).toBe(0.01);
    expect(clampRuler({ ...r, y: -1 }).y).toBeCloseTo(r.height / 2);
  });
});
