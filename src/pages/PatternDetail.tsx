import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import {
  addFilesToPattern,
  deleteFile,
  deletePattern,
  getBlob,
  getFileDeletionSummary,
  getPatternDeletionSummary,
  markPatternOpened,
  setPatternCover,
  setStatus,
  updateFile,
} from "../db/repo";
import { FILE_KIND_LABELS, FILE_KIND_ORDER, type FileKind, type Pattern, type PatternFile } from "../db/types";
import { Cover, EmptyState, FavoriteButton } from "../components/PatternParts";
import { ExternalLinkButton, FileKindSelect, FileSelection, StatusPicker, type PendingFile } from "../components/Inputs";
import { useFeedback } from "../components/Feedback";
import { CounterList, NotesEditor } from "../components/Counters";
import { formatBytes, formatDate, formatPrice } from "../lib/format";
import { prepareFiles, readImage } from "../lib/importFiles";
import { inspectPdf } from "../lib/pdf";

/** 「続きから編む」で開くファイル：最後に開いたもの → 日本語版 → 先頭 */
export function primaryFile(files: PatternFile[]): PatternFile | undefined {
  const opened = files.filter((f) => f.lastOpenedAt).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!);
  return opened[0] ?? files.find((f) => f.kind === "translation") ?? files[0];
}

export default function PatternDetail() {
  const { id = "" } = useParams();
  const pattern = useLiveQuery(() => db.patterns.get(id).then((p) => p ?? null), [id]);
  const files = useLiveQuery(() => db.files.where("patternId").equals(id).sortBy("createdAt"), [id]);
  const categories = useLiveQuery(() => db.categories.toArray(), []);

  useEffect(() => {
    if (id) void markPatternOpened(id);
  }, [id]);

  if (pattern === null) {
    return (
      <EmptyState title="作品が見つかりません。">
        <p>削除された可能性があります。</p>
        <Link className="btn" to="/library">
          ライブラリへ戻る
        </Link>
      </EmptyState>
    );
  }
  if (!pattern || !files) return <div className="page loading">読み込み中…</div>;

  const catNames = pattern.categoryIds.map((cid) => categories?.find((c) => c.id === cid)?.name).filter(Boolean);

  return (
    <div className="page detail">
      <header className="page-header">
        <BackButton />
        <h1 className="visually-hidden">{pattern.title}</h1>
        <Link className="btn btn-ghost" to={`/patterns/${id}/edit`}>
          編集
        </Link>
      </header>

      <div className="detail-hero">
        <CoverEditor pattern={pattern} files={files} />
        <div className="detail-head">
          <div className="detail-title-row">
            <h2 className="detail-title">{pattern.title}</h2>
            <FavoriteButton pattern={pattern} />
          </div>
          {pattern.designer && <p className="muted">デザイン：{pattern.designer}</p>}
          <StartButton pattern={pattern} files={files} />
        </div>
      </div>

      <section className="section">
        <h3 className="section-title">制作ステータス</h3>
        <StatusChanger pattern={pattern} />
      </section>

      {(catNames.length > 0 || pattern.tags.length > 0) && (
        <section className="section">
          <div className="chips">
            {catNames.map((n) => (
              <span key={n} className="chip static">
                {n}
              </span>
            ))}
            {pattern.tags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        </section>
      )}

      <FilesSection pattern={pattern} files={files} />

      <PurchaseInfo pattern={pattern} />

      <section className="section">
        <h3 className="section-title">段数カウンター</h3>
        <CounterList patternId={pattern.id} />
      </section>

      <section className="section">
        <h3 className="section-title">制作メモ</h3>
        <NotesEditor key={pattern.id} patternId={pattern.id} initial={pattern.notes} />
      </section>

      <DangerZone pattern={pattern} />
    </div>
  );
}

function BackButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/library"))}
    >
      ‹ 戻る
    </button>
  );
}

function StartButton({ pattern, files }: { pattern: Pattern; files: PatternFile[] }) {
  const navigate = useNavigate();
  const { showError } = useFeedback();
  const target = primaryFile(files);
  const inProgress = pattern.status === "in_progress";
  const label = inProgress ? "続きから編む" : pattern.status === "paused" ? "制作を再開する" : pattern.status === "done" ? "もう一度開く" : "制作を始める";
  return (
    <button
      type="button"
      className="btn btn-primary btn-start"
      onClick={async () => {
        try {
          if (pattern.status !== "in_progress" && pattern.status !== "done") await setStatus(pattern.id, "in_progress");
          if (target) navigate(`/patterns/${pattern.id}/files/${target.id}`);
        } catch (e) {
          showError(e);
        }
      }}
    >
      {label}
      {target && <small className="btn-sub">{target.name}</small>}
    </button>
  );
}

function StatusChanger({ pattern }: { pattern: Pattern }) {
  const { showError } = useFeedback();
  return <StatusPicker value={pattern.status} onChange={(s) => setStatus(pattern.id, s).catch((e) => showError(e))} />;
}

function CoverEditor({ pattern, files }: { pattern: Pattern; files: PatternFile[] }) {
  const { showError, confirm, toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const firstPdf = files.find((f) => f.mimeType === "application/pdf");

  const fromPdf = async () => {
    setOpen(false);
    try {
      const blob = firstPdf && (await getBlob(firstPdf.blobId));
      if (!blob) return;
      const info = await inspectPdf(await blob.arrayBuffer(), { thumbnail: true });
      if (!info.thumbnail) {
        toast("このPDFからは表紙を作成できませんでした。画像を選んでください。", "error");
        return;
      }
      await setPatternCover(pattern.id, { type: info.thumbnail.type, data: await info.thumbnail.arrayBuffer() });
    } catch (e) {
      showError(e);
    }
  };

  return (
    <div className="cover-editor">
      <button type="button" className="cover-btn" onClick={() => setOpen((o) => !o)} aria-label="表紙画像を変更">
        <Cover pattern={pattern} className="detail-cover" />
        <span className="cover-edit-hint">表紙を変更</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => (setOpen(false), input.current?.click())}>
            画像を選ぶ
          </button>
          {firstPdf && (
            <button role="menuitem" onClick={fromPdf}>
              PDFの1ページ目を使う
            </button>
          )}
          {pattern.coverBlobId && (
            <button
              role="menuitem"
              className="danger"
              onClick={async () => {
                setOpen(false);
                if (await confirm({ title: "表紙画像を削除しますか？", confirmLabel: "削除", danger: true })) {
                  setPatternCover(pattern.id, null).catch((e) => showError(e));
                }
              }}
            >
              表紙画像を削除
            </button>
          )}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            await setPatternCover(pattern.id, await readImage(f));
          } catch (err) {
            showError(err);
          }
        }}
      />
    </div>
  );
}

function FilesSection({ pattern, files }: { pattern: Pattern; files: PatternFile[] }) {
  const { toast, showError } = useFeedback();
  const [adding, setAdding] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const groups = FILE_KIND_ORDER.map((k) => [k, files.filter((f) => f.kind === k)] as const).filter(([, l]) => l.length);

  const add = async () => {
    setBusy(true);
    try {
      const prepared = await prepareFiles(adding, { thumbnail: !pattern.coverBlobId });
      await addFilesToPattern(pattern.id, prepared.inputs);
      if (prepared.thumbnail && !pattern.coverBlobId) await setPatternCover(pattern.id, prepared.thumbnail);
      prepared.warnings.forEach((w) => toast(w, "error"));
      toast(`${prepared.inputs.length}件のファイルを追加しました`);
      setAdding([]);
    } catch (e) {
      showError(e, "ファイルを追加できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <h3 className="section-title">ファイル</h3>
      {groups.length === 0 && <p className="muted">まだファイルが登録されていません。</p>}
      {groups.map(([kind, list]) => (
        <div key={kind} className="file-group">
          <h4 className="file-group-title">{FILE_KIND_LABELS[kind]}</h4>
          <ul className="file-list">
            {list.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </ul>
        </div>
      ))}
      <div className="add-files">
        <FileSelection value={adding} onChange={setAdding} />
        {adding.length > 0 && (
          <button type="button" className="btn btn-primary btn-block" onClick={add} disabled={busy}>
            {busy ? "追加中…" : `${adding.length}件のファイルを追加する`}
          </button>
        )}
      </div>
    </section>
  );
}

function FileRow({ file }: { file: PatternFile }) {
  const { confirm, showError, toast } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(file.name);
  const [kind, setKind] = useState<FileKind>(file.kind);

  if (editing) {
    return (
      <li className="file-row editing">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="ファイル名" />
        <FileKindSelect value={kind} onChange={setKind} />
        <div className="row-actions">
          <button type="button" className="btn btn-small" onClick={() => (setEditing(false), setName(file.name), setKind(file.kind))}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-small btn-primary"
            onClick={async () => {
              try {
                await updateFile(file.id, { name, kind });
                setEditing(false);
              } catch (e) {
                showError(e);
              }
            }}
          >
            保存
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger-text"
            onClick={async () => {
              const { annotations } = await getFileDeletionSummary(file.id);
              const ok = await confirm({
                title: "このファイルを削除しますか？",
                message: (
                  <>
                    <p className="break">{file.name}</p>
                    <p>端末内のファイル本体{annotations ? `と、このファイルの注釈${annotations}件` : ""}が削除されます。元に戻せません。</p>
                    <p className="muted">同じ作品の他のファイルや、他の作品には影響しません。</p>
                  </>
                ),
                confirmLabel: "削除",
                danger: true,
              });
              if (!ok) return;
              try {
                await deleteFile(file.id);
                toast("ファイルを削除しました");
              } catch (e) {
                showError(e);
              }
            }}
          >
            削除
          </button>
        </div>
      </li>
    );
  }

  const isPdf = file.mimeType === "application/pdf";
  return (
    <li className="file-row">
      <Link to={`/patterns/${file.patternId}/files/${file.id}`} className="file-open">
        <span className={`file-icon ${isPdf ? "pdf" : "img"}`}>{isPdf ? "PDF" : "IMG"}</span>
        <span className="file-info">
          <span className="file-name break">{file.name}</span>
          <small className="muted">
            {formatBytes(file.size)}
            {file.pageCount ? `・${file.pageCount}ページ` : ""}
            {file.viewState ? `・前回 ${file.viewState.page}ページ目` : ""}
          </small>
        </span>
      </Link>
      <button type="button" className="icon-btn" aria-label={`${file.name} の名前・種別を変更`} onClick={() => setEditing(true)}>
        ⋯
      </button>
    </li>
  );
}

function PurchaseInfo({ pattern }: { pattern: Pattern }) {
  const rows: [string, string | undefined][] = [
    ["ショップ", pattern.shopName],
    ["購入日", pattern.purchaseDate ? formatDate(new Date(pattern.purchaseDate).getTime()) : undefined],
    ["購入価格", formatPrice(pattern.price, pattern.currency) || undefined],
    ["使用糸", pattern.yarn],
    ["使用針", pattern.needles],
    ["サイズ", pattern.size],
    ["ゲージ", pattern.gauge],
    ["難易度", pattern.difficulty],
  ];
  const shown = rows.filter(([, v]) => v);
  if (!shown.length && !pattern.purchaseUrl) return null;
  return (
    <section className="section">
      <h3 className="section-title">購入情報・詳細</h3>
      {pattern.purchaseUrl && (
        <div className="url-row">
          <span className="break small muted">{pattern.purchaseUrl}</span>
          <ExternalLinkButton url={pattern.purchaseUrl} />
        </div>
      )}
      {shown.length > 0 && (
        <dl className="info-list">
          {shown.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function DangerZone({ pattern }: { pattern: Pattern }) {
  const { confirm, showError, toast } = useFeedback();
  const navigate = useNavigate();
  return (
    <section className="section danger-zone">
      <button
        type="button"
        className="btn btn-danger-text"
        onClick={async () => {
          const s = await getPatternDeletionSummary(pattern.id);
          const parts = [
            s.files && `ファイル${s.files}件`,
            s.counters && `段数カウンター${s.counters}件`,
            s.annotations && `注釈${s.annotations}件`,
          ].filter(Boolean);
          const ok = await confirm({
            title: "この作品を削除しますか？",
            message: (
              <>
                <p className="break">「{pattern.title}」</p>
                <p>
                  作品情報{parts.length ? `と、${parts.join("・")}` : ""}が端末から削除されます。元に戻せません。
                </p>
                <p className="muted">他の作品のデータには影響しません。</p>
              </>
            ),
            confirmLabel: "削除する",
            danger: true,
          });
          if (!ok) return;
          try {
            await deletePattern(pattern.id);
            toast("作品を削除しました");
            navigate("/library", { replace: true });
          } catch (e) {
            showError(e);
          }
        }}
      >
        この作品を削除
      </button>
    </section>
  );
}
