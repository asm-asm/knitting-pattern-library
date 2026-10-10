import { memo, useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// iOS の canvas 上限（約1677万画素）より余裕を持たせる
const MAX_CANVAS_PIXELS = 12_000_000;

/** PDF の1ページを canvas に描画する。active=false のときは画像メモリを解放する。 */
export const PdfPageCanvas = memo(function PdfPageCanvas({
  doc,
  index,
  width,
  active,
}: {
  doc: PDFDocumentProxy;
  index: number;
  width: number;
  active: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!active) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    let cancelled = false;
    let task: RenderTask | undefined;
    // 拡大縮小中は連続で描画し直さないよう少し待つ
    const timer = setTimeout(async () => {
      try {
        const page = await doc.getPage(index + 1);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        let scale = (width * dpr) / base.width;
        if (base.width * base.height * scale * scale > MAX_CANVAS_PIXELS) {
          scale = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height));
        }
        const viewport = page.getViewport({ scale });
        // 描画が終わるまで前の画像を表示しておくため、別の canvas に描いてから差し替える
        const off = document.createElement("canvas");
        off.width = Math.floor(viewport.width);
        off.height = Math.floor(viewport.height);
        const ctx = off.getContext("2d");
        if (!ctx) return;
        task = page.render({ canvas: off, canvasContext: ctx, viewport });
        await task.promise;
        if (cancelled) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext("2d")?.drawImage(off, 0, 0);
        off.width = 0;
        off.height = 0;
      } catch (e) {
        if ((e as { name?: string })?.name !== "RenderingCancelledException") console.warn(e);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, index, width, active]);

  return <canvas ref={ref} className="page-canvas" />;
});
