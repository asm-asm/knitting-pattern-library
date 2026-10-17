import { useState, type ReactNode } from "react";
import type { PatternFile } from "../db/types";
import { useFeedback } from "./Feedback";
import { hasAnnotations, printPatternFile } from "../lib/print";

/** 登録したファイルを印刷する。書き込みがあれば、一緒に印刷するかを選べる。 */
export function PrintButton({ file, className, children }: { file: PatternFile; className: string; children: ReactNode }) {
  const { choose, showError } = useFeedback();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      aria-label={`${file.name} を印刷`}
      aria-busy={busy}
      onClick={async () => {
        try {
          let withAnnotations = false;
          if (await hasAnnotations(file.id)) {
            const c = await choose({
              title: "印刷",
              message: "マーカー・ペン・メモの書き込みも一緒に印刷しますか？",
              confirmLabel: "書き込みも印刷",
              cancelLabel: file.mimeType === "application/pdf" ? "元のPDFのまま" : "元の画像のまま",
            });
            if (c === "dismiss") return;
            withAnnotations = c === "confirm";
          }
          setBusy(true);
          await printPatternFile(file, { withAnnotations });
        } catch (e) {
          showError(e, "印刷できませんでした。もう一度お試しください。");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "準備中…" : children}
    </button>
  );
}
