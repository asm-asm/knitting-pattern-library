// pdf.js の読み込みと、PDF の検査（ページ数・表紙サムネイル生成）。
// pdf.js は大きいので必要になった時点で遅延読み込みする。CMap 等はアプリ同梱のものを使い、外部通信しない。
import type { PDFDocumentProxy } from "pdfjs-dist";
import { UserFacingError } from "../db/repo";

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    // 古めの iOS WebView でも動くよう legacy ビルドを使う
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })().catch((e) => {
    pdfjsPromise = null;
    throw e;
  });
  return pdfjsPromise;
}

function assetBase() {
  return new URL("pdfjs/", document.baseURI).href;
}

export class PdfPasswordError extends UserFacingError {}

export async function openPdf(data: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const base = assetBase();
  try {
    return await pdfjs.getDocument({
      // worker へ転送されると元のバッファが使えなくなるのでコピーを渡す
      data: new Uint8Array(data.slice(0)),
      password,
      cMapUrl: base + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: base + "standard_fonts/",
      wasmUrl: base + "wasm/",
    }).promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") {
      throw new PdfPasswordError(
        password ? "パスワードが正しくありません。もう一度入力してください。" : "このPDFはパスワードで保護されています。",
      );
    }
    throw new UserFacingError("PDFを読み込めませんでした。ファイルが壊れているか、対応していない形式の可能性があります。");
  }
}

export interface PdfInfo {
  pageCount?: number;
  /** パスワード保護されていてページ数等を取得できなかった */
  encrypted?: boolean;
  thumbnail?: Blob;
}

/** 登録前の検査。破損していれば UserFacingError。パスワード付きは登録自体は許可する。 */
export async function inspectPdf(data: ArrayBuffer, opts: { thumbnail?: boolean } = {}): Promise<PdfInfo> {
  let doc: PDFDocumentProxy;
  try {
    doc = await openPdf(data);
  } catch (e) {
    if (e instanceof PdfPasswordError) return { encrypted: true };
    throw e;
  }
  try {
    const info: PdfInfo = { pageCount: doc.numPages };
    if (opts.thumbnail) info.thumbnail = await renderThumbnail(doc).catch(() => undefined);
    return info;
  } finally {
    void doc.loadingTask.destroy();
  }
}

async function renderThumbnail(doc: PDFDocumentProxy, width = 600): Promise<Blob | undefined> {
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / vp1.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), "image/jpeg", 0.85));
}
