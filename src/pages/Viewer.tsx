import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { db } from "../db/db";
import { getBlob, markPatternOpened } from "../db/repo";
import { EmptyState } from "../components/PatternParts";
import { errorMessage } from "../components/Feedback";
import { openPdf, PdfPasswordError } from "../lib/pdf";
import type { PageSize } from "../viewer/layout";
import { ViewerCore, type ViewerSource } from "../viewer/ViewerCore";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; source: ViewerSource }
  | { status: "password"; message: string }
  | { status: "error"; message: string };

export default function Viewer() {
  const { id = "", fileId = "" } = useParams();
  const file = useLiveQuery(() => db.files.get(fileId).then((f) => f ?? null), [fileId]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [password, setPassword] = useState<string>();
  const blobId = file?.blobId;
  const mimeType = file?.mimeType;

  useEffect(() => {
    void markPatternOpened(id);
  }, [id]);

  // ファイル本体の読み込み（閲覧位置の保存で file が更新されても読み込み直さない）
  useEffect(() => {
    if (!blobId || !mimeType) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    setState({ status: "loading" });
    (async () => {
      const blob = await getBlob(blobId);
      if (!blob) throw new Error("missing-blob");
      if (mimeType === "application/pdf") {
        const doc: PDFDocumentProxy = await openPdf(await blob.arrayBuffer(), password);
        cleanup = () => void doc.loadingTask.destroy();
        const sizes: PageSize[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        // パスワード付きで登録時にページ数が取れなかった場合などに補完する
        void db.files.update(fileId, { pageCount: doc.numPages });
        return { kind: "pdf", doc, sizes } satisfies ViewerSource;
      }
      const url = URL.createObjectURL(blob);
      cleanup = () => URL.revokeObjectURL(url);
      const img = new Image();
      img.src = url;
      await img.decode();
      return { kind: "image", url, sizes: [{ w: img.naturalWidth, h: img.naturalHeight }] } satisfies ViewerSource;
    })()
      .then((source) => {
        if (cancelled) cleanup?.();
        else setState({ status: "ready", source });
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof PdfPasswordError) setState({ status: "password", message: e.message });
        else if ((e as Error)?.message === "missing-blob")
          setState({ status: "error", message: "ファイルの本体が見つかりません。バックアップから復元するか、ファイルを登録し直してください。" });
        else setState({ status: "error", message: errorMessage(e, "ファイルを開けませんでした。ファイルが壊れている可能性があります。") });
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [blobId, mimeType, fileId, password]);

  if (file === null) {
    return (
      <EmptyState title="ファイルが見つかりません">
        <p>削除された可能性があります。</p>
        <Link className="btn" to={`/patterns/${id}`}>
          作品に戻る
        </Link>
      </EmptyState>
    );
  }
  if (!file || state.status === "loading") return <div className="page loading">開いています…</div>;
  if (state.status === "error") {
    return (
      <EmptyState title="ファイルを開けませんでした">
        <p>{state.message}</p>
        <Link className="btn" to={`/patterns/${id}`}>
          作品に戻る
        </Link>
      </EmptyState>
    );
  }
  if (state.status === "password") {
    return <PasswordForm patternId={id} message={state.message} onSubmit={setPassword} />;
  }
  return <ViewerCore key={file.id} file={file} source={state.source} initialViewState={file.viewState} />;
}

function PasswordForm({ patternId, message, onSubmit }: { patternId: string; message: string; onSubmit: (p: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="empty"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <p className="empty-title">パスワードが必要です</p>
      <p>{message}</p>
      <p className="muted small">パスワードは保存されません。開くたびに入力してください。</p>
      <input className="input" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="PDFのパスワード" style={{ maxWidth: 320 }} />
      <div className="row-actions">
        <Link className="btn" to={`/patterns/${patternId}`}>
          作品に戻る
        </Link>
        <button type="submit" className="btn btn-primary" disabled={!value}>
          開く
        </button>
      </div>
    </form>
  );
}
