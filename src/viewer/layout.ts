// ビューアのページ配置計算（DOM に依存しない純粋関数）

export interface PageSize {
  w: number;
  h: number;
}

export interface PageBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Layout {
  pages: PageBox[];
  contentWidth: number;
  contentHeight: number;
}

export const SIDE_PAD = 12;
export const GAP = 12;
export const TOP_PAD = 12;
export const BOTTOM_PAD = 48;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 5;
const MAX_BASE_WIDTH = 1000;

export function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** 等倍（zoom=1）で、最も幅の広いページが画面幅に収まるように配置する */
export function computeLayout(sizes: PageSize[], viewportWidth: number, zoom: number): Layout {
  const maxW = Math.max(1, ...sizes.map((s) => s.w));
  const base = Math.max(100, Math.min(viewportWidth - SIDE_PAD * 2, MAX_BASE_WIDTH)) * zoom;
  const widths = sizes.map((s) => (base * s.w) / maxW);
  const contentWidth = Math.max(viewportWidth, Math.max(0, ...widths) + SIDE_PAD * 2);
  let top = TOP_PAD;
  const pages = sizes.map((s, i) => {
    const width = widths[i];
    const height = (width * s.h) / s.w;
    const box = { top, left: Math.max(SIDE_PAD, (contentWidth - width) / 2), width, height };
    top += height + GAP;
    return box;
  });
  return { pages, contentWidth, contentHeight: top - GAP + BOTTOM_PAD };
}

/** 縦位置 y にあるページ（間の余白は直前のページ扱い）の index */
export function pageIndexAt(layout: Layout, y: number): number {
  const { pages } = layout;
  let lo = 0;
  let hi = pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pages[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** 描画すべきページ範囲（表示中の前後 1 画面分を含む） */
export function renderRange(layout: Layout, scrollTop: number, viewportHeight: number): [number, number] {
  if (!layout.pages.length) return [0, -1];
  const first = pageIndexAt(layout, scrollTop - viewportHeight);
  const last = pageIndexAt(layout, scrollTop + viewportHeight * 2);
  return [first, last];
}

export interface Anchor {
  page: number;
  fx: number;
  fy: number;
}

/** 画面上の点 (vx, vy) が指している、ページ内の相対位置 */
export function anchorAt(layout: Layout, scrollLeft: number, scrollTop: number, vx: number, vy: number): Anchor {
  const y = scrollTop + vy;
  const page = pageIndexAt(layout, y);
  const box = layout.pages[page];
  return {
    page,
    fx: (scrollLeft + vx - box.left) / box.width,
    fy: (y - box.top) / box.height,
  };
}

/** anchor が画面上の (vx, vy) に来るスクロール位置 */
export function scrollForAnchor(layout: Layout, a: Anchor, vx: number, vy: number) {
  const box = layout.pages[Math.min(a.page, layout.pages.length - 1)];
  return {
    left: box.left + a.fx * box.width - vx,
    top: box.top + a.fy * box.height - vy,
  };
}
