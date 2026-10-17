import { memo, useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractLinks, type LinkTarget, type PageLink } from "./links";

/** PDF のリンクの位置に、押せる領域を重ねる（見た目は押したときだけ色が付く） */
export const PdfLinkLayer = memo(function PdfLinkLayer({
  doc,
  index,
  onLink,
}: {
  doc: PDFDocumentProxy;
  index: number;
  onLink: (target: LinkTarget) => void;
}) {
  const [links, setLinks] = useState<PageLink[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(index + 1);
      const annotations = await page.getAnnotations({ intent: "display" });
      if (!cancelled) setLinks(extractLinks(annotations, page.getViewport({ scale: 1 })));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [doc, index]);

  if (!links.length) return null;
  return (
    <div className="link-layer">
      {links.map((l, i) => (
        <button
          key={i}
          type="button"
          className="pdf-link"
          style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
          aria-label={l.target.kind === "url" ? `リンク：${l.target.url}` : "ページ内リンク"}
          onClick={() => onLink(l.target)}
        />
      ))}
    </div>
  );
});
