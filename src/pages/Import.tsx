import { useMemo, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { addFilesToPattern, setPatternCover } from "../db/repo";
import { FileSelection, type PendingFile } from "../components/Inputs";
import { Cover, EmptyState, StatusBadge } from "../components/PatternParts";
import { useFeedback } from "../components/Feedback";
import { guessFileKind } from "../lib/format";
import { prepareFiles } from "../lib/importFiles";
import { normalizeForSearch } from "../lib/search";
import { clearIncomingFiles, peekIncomingFiles, subscribeIncomingFiles } from "../lib/native";

let seq = 0;
export function toPending(files: File[]): PendingFile[] {
  return files.map((file) => ({
    key: `in${++seq}`,
    file,
    kind: file.type.startsWith("image/") ? "chart" : guessFileKind(file.name),
  }));
}

/** 共有メニュー等から受け取ったファイルを、新しい作品にするか既存の作品に追加するか選ぶ画面 */
export default function Import() {
  const navigate = useNavigate();
  const { toast, showError } = useFeedback();
  const received = useSyncExternalStore(subscribeIncomingFiles, peekIncomingFiles);
  const [pending, setPending] = useState<PendingFile[]>(() => toPending(peekIncomingFiles()));
  const [seen, setSeen] = useState(received);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const patterns = useLiveQuery(() => db.patterns.orderBy("updatedAt").reverse().toArray(), []);

  // 画面を開いている間に、さらにファイルを受け取った場合は追加する
  if (received !== seen) {
    setSeen(received);
    const known = new Set(pending.map((p) => p.file));
    setPending([...pending, ...toPending(received.filter((f) => !known.has(f)))]);
  }

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    return (patterns ?? []).filter((p) => !q || normalizeForSearch(`${p.title} ${p.designer ?? ""}`).includes(q));
  }, [patterns, query]);

  if (!pending.length) {
    return (
      <EmptyState title="受け取ったファイルはありません">
        <p>他のアプリの共有メニューから「編み図ライブラリ」を選ぶと、PDFをここに取り込めます。</p>
        <Link className="btn" to="/">
          ホームへ
        </Link>
      </EmptyState>
    );
  }

  const addTo = async (patternId: string, hasCover: boolean) => {
    setBusy(true);
    try {
      const prepared = await prepareFiles(pending, { thumbnail: !hasCover });
      await addFilesToPattern(patternId, prepared.inputs);
      if (prepared.thumbnail && !hasCover) await setPatternCover(patternId, prepared.thumbnail);
      prepared.warnings.forEach((w) => toast(w, "error"));
      clearIncomingFiles();
      toast(`${prepared.inputs.length}件のファイルを追加しました`);
      navigate(`/patterns/${patternId}`, { replace: true });
    } catch (e) {
      showError(e, "ファイルを追加できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page import form">
      <header className="page-header">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            clearIncomingFiles();
            navigate("/", { replace: true });
          }}
        >
          取り消す
        </button>
        <h1>受け取ったファイル</h1>
      </header>

      <section className="form-section">
        <p className="hint">ファイルの種類（英語原本・日本語翻訳版など）を確認してください。ファイルはアプリ内にコピーして保存するので、登録後に元のファイルを削除しても大丈夫です。</p>
        <FileSelection value={pending} onChange={setPending} />
      </section>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={() => {
          // 新規登録画面へ引き継ぐ（種別の選択も引き継ぐ）
          handoffToNew(pending);
          clearIncomingFiles();
          navigate("/new", { replace: true });
        }}
      >
        新しい作品として登録する
      </button>

      <section className="section">
        <h2 className="section-title">既存の作品に追加する</h2>
        <input
          type="search"
          className="input"
          placeholder="作品を検索"
          aria-label="追加先の作品を検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="list import-targets">
          {filtered.map((p) => (
            <button key={p.id} type="button" className="row" disabled={busy} onClick={() => addTo(p.id, !!p.coverBlobId)}>
              <Cover pattern={p} className="row-thumb" />
              <span className="row-body">
                <span className="row-title">{p.title}</span>
                <span className="row-meta">
                  <StatusBadge status={p.status} />
                </span>
              </span>
              <span className="muted">追加 ›</span>
            </button>
          ))}
          {patterns && !filtered.length && <p className="muted">{patterns.length ? "該当する作品がありません。" : "まだ作品がありません。「新しい作品として登録する」を選んでください。"}</p>}
        </div>
      </section>
    </div>
  );
}

// 新規登録画面への受け渡し
let handoff: PendingFile[] = [];
function handoffToNew(files: PendingFile[]) {
  handoff = files;
}
export function peekHandoff(): PendingFile[] {
  return handoff;
}
export function clearHandoff() {
  handoff = [];
}
