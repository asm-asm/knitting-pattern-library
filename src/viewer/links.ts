// PDF 内のリンク（目次から各ページへの移動、外部サイトへのリンク）
import type { PDFDocumentProxy } from "pdfjs-dist";

export type LinkTarget = { kind: "url"; url: string } | { kind: "dest"; dest: unknown } | { kind: "named"; action: string };

/** ページ上のリンク。位置はページ幅・高さに対する 0〜1 の割合 */
export interface PageLink {
  x: number;
  y: number;
  w: number;
  h: number;
  target: LinkTarget;
}

interface ViewportLike {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/** 開いてよい外部リンク（Web とメールだけ。javascript: などは開かない） */
export function isOpenableUrl(url: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** pdf.js の注釈データからリンクを取り出す（倍率1のビューポートを渡す） */
export function extractLinks(annotations: unknown[], viewport: ViewportLike): PageLink[] {
  const links: PageLink[] = [];
  for (const raw of annotations) {
    const a = raw as { subtype?: string; rect?: number[]; url?: string; dest?: unknown; action?: string };
    if (a.subtype !== "Link" || !a.rect || a.rect.length !== 4) continue;
    let target: LinkTarget | undefined;
    if (a.url && isOpenableUrl(a.url)) target = { kind: "url", url: a.url };
    else if (a.dest) target = { kind: "dest", dest: a.dest };
    else if (a.action) target = { kind: "named", action: a.action };
    if (!target) continue;
    const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
    const x = Math.min(x1, x2) / viewport.width;
    const y = Math.min(y1, y2) / viewport.height;
    const w = Math.abs(x2 - x1) / viewport.width;
    const h = Math.abs(y2 - y1) / viewport.height;
    if (w <= 0 || h <= 0) continue;
    links.push({ x, y, w, h, target });
  }
  return links;
}

/** ページ内のリンク先（移動先ページは0始まり、y はページの高さに対する割合） */
export async function resolveDestination(
  doc: PDFDocumentProxy,
  target: Exclude<LinkTarget, { kind: "url" }>,
  currentPage: number,
): Promise<{ page: number; y?: number } | undefined> {
  if (target.kind === "named") {
    const last = doc.numPages - 1;
    const page = { NextPage: currentPage + 1, PrevPage: currentPage - 1, FirstPage: 0, LastPage: last }[target.action];
    return page === undefined ? undefined : { page: Math.max(0, Math.min(last, page)) };
  }
  const explicit = typeof target.dest === "string" ? await doc.getDestination(target.dest) : target.dest;
  if (!Array.isArray(explicit) || !explicit.length) return undefined;
  const ref = explicit[0];
  let page: number;
  if (Number.isInteger(ref)) page = ref as number;
  else if (ref && typeof ref === "object") page = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
  else return undefined;
  // 位置の指定があれば、その高さまで移動する（XYZ は4番目、FitH・FitBH は3番目が上端）
  const mode = (explicit[1] as { name?: string } | undefined)?.name;
  const top = mode === "XYZ" ? explicit[3] : mode === "FitH" || mode === "FitBH" ? explicit[2] : undefined;
  if (typeof top !== "number") return { page };
  const vp = (await doc.getPage(page + 1)).getViewport({ scale: 1 });
  const [, vy] = vp.convertToViewportPoint(0, top);
  return { page, y: Math.max(0, Math.min(1, vy / vp.height)) };
}
