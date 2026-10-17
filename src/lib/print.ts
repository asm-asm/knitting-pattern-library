// 登録した PDF・画像の印刷。
// 「元のまま」は PDF・画像をそのまま印刷画面に渡す。
// 「書き込みも印刷」は各ページを画像にして、マーカー・ペン・メモを重ねてから渡す（元のファイルは変更しない）。
import type { PDFDocumentProxy } from "pdfjs-dist";
import { db } from "../db/db";
import { getBlob, UserFacingError } from "../db/repo";
import type { Annotation, PatternFile } from "../db/types";
import { inkPath } from "../viewer/ink";
import { isNativeApp, printFilesNative } from "./native";
import { openPdf, PdfPasswordError } from "./pdf";

/** 印刷用の画像の長辺（A4 で約 200dpi） */
const PRINT_LONG_SIDE = 2300;

export async function hasAnnotations(fileId: string): Promise<boolean> {
  return (await db.annotations.where("fileId").equals(fileId).count()) > 0;
}

/** 印刷画面を開く。印刷した（または印刷画面を開いた）ら true */
export async function printPatternFile(file: PatternFile, opts: { withAnnotations: boolean }): Promise<boolean> {
  const blob = await getBlob(file.blobId);
  if (!blob) throw new UserFacingError("ファイルの本体が見つかりません。バックアップから復元するか、ファイルを登録し直してください。");
  const annotations = opts.withAnnotations ? await db.annotations.where("fileId").equals(file.id).toArray() : [];
  if (!annotations.length) {
    if (isNativeApp()) return printFilesNative([{ blob, name: safeName(file.name, file.mimeType) }], file.name);
    return printInBrowser([{ blob, type: file.mimeType }]);
  }
  const pages = await renderPagesWithAnnotations(blob, file.mimeType, annotations);
  if (isNativeApp()) return printFilesNative(pages.map((p, i) => ({ blob: p, name: `page-${i + 1}.jpg` })), file.name);
  return printInBrowser(pages.map((p) => ({ blob: p, type: "image/jpeg" })));
}

function safeName(name: string, mimeType: string) {
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "file";
  const ext = mimeType === "application/pdf" ? ".pdf" : mimeType === "image/png" ? ".png" : mimeType === "image/jpeg" ? ".jpg" : "";
  return ext && !base.toLowerCase().endsWith(ext) ? base + ext : base;
}

/** 1ページずつ画像にして書き込みを重ねる（メモリを抑えるため順番に処理する） */
async function renderPagesWithAnnotations(blob: Blob, mimeType: string, annotations: Annotation[]): Promise<Blob[]> {
  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations) byPage.set(a.page, [...(byPage.get(a.page) ?? []), a]);
  const out: Blob[] = [];
  if (mimeType === "application/pdf") {
    let doc: PDFDocumentProxy;
    try {
      doc = await openPdf(await blob.arrayBuffer());
    } catch (e) {
      if (e instanceof PdfPasswordError) throw new UserFacingError("パスワード付きのPDFは、書き込みを含めて印刷できません。「元のPDFのまま」で印刷してください。");
      throw e;
    }
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: PRINT_LONG_SIDE / Math.max(base.width, base.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        drawAnnotations(ctx, canvas.width, canvas.height, byPage.get(i) ?? []);
        out.push(await toJpeg(canvas));
        page.cleanup();
      }
    } finally {
      void doc.loadingTask.destroy();
    }
    return out;
  }
  // 画像（1ページ）
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, PRINT_LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawAnnotations(ctx, canvas.width, canvas.height, byPage.get(1) ?? []);
    out.push(await toJpeg(canvas));
  } finally {
    URL.revokeObjectURL(url);
  }
  return out;
}

/** 画面と同じ見た目で書き込みを描く（座標はページ幅・高さに対する割合） */
export function drawAnnotations(ctx: CanvasRenderingContext2D, w: number, h: number, annotations: Annotation[]) {
  const aspect = h / w;
  const k = w / 1000; // inkPath は幅1000の座標系
  for (const a of annotations) {
    if (a.type !== "ink") continue;
    ctx.save();
    ctx.scale(k, k);
    ctx.strokeStyle = a.color;
    ctx.globalAlpha = a.opacity;
    ctx.lineWidth = a.width * 1000;
    ctx.lineCap = a.opacity < 1 ? "butt" : "round";
    ctx.lineJoin = "round";
    if (a.opacity < 1) ctx.globalCompositeOperation = "multiply";
    ctx.stroke(new Path2D(inkPath(a.points, aspect)));
    ctx.restore();
  }
  // メモは付箋のように本文を表示する
  const font = Math.round(w * 0.016);
  const pad = Math.round(font * 0.5);
  const maxW = w * 0.34;
  for (const a of annotations) {
    if (a.type !== "note") continue;
    ctx.save();
    ctx.font = `${font}px "Hiragino Sans", "Yu Gothic", sans-serif`;
    const lines = wrapText(ctx, a.text, maxW - pad * 2).slice(0, 8);
    const boxW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
    const boxH = lines.length * font * 1.35 + pad * 2;
    const x = Math.min(Math.max(0, a.x * w), w - boxW);
    const y = Math.min(Math.max(0, a.y * h), h - boxH);
    ctx.fillStyle = "rgba(255, 236, 140, 0.95)";
    ctx.strokeStyle = "#c9a400";
    ctx.lineWidth = Math.max(1, w * 0.001);
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.fillStyle = "#3a2a00";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * font * 1.35));
    ctx.restore();
  }
}

/** 1文字ずつ幅を測って折り返す（日本語は単語の区切りがないため） */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

async function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new UserFacingError("印刷用の画像を作れませんでした。端末の空き容量を確認してください。");
  return blob;
}

/** ブラウザ版：隠した iframe に表示して印刷する */
async function printInBrowser(items: { blob: Blob; type: string }[]): Promise<boolean> {
  document.getElementById("print-frame")?.remove();
  const urls = items.map((i) => URL.createObjectURL(i.blob));
  const frame = document.createElement("iframe");
  frame.id = "print-frame";
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const cleanup = () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 60_000);
  if (items.length === 1 && items[0].type === "application/pdf") {
    frame.src = urls[0];
    await new Promise((r) => (frame.onload = r));
  } else {
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(
      `<!doctype html><html><head><style>@page{margin:8mm}body{margin:0}img{display:block;max-width:100%;max-height:100vh;margin:0 auto;page-break-after:always}img:last-child{page-break-after:auto}</style></head><body>${urls
        .map((u) => `<img src="${u}">`)
        .join("")}</body></html>`,
    );
    doc.close();
    await Promise.all(Array.from(doc.images).map((img) => img.decode().catch(() => undefined)));
  }
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  cleanup();
  return true;
}
