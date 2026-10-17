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
  UserFacingError,
  ACCEPTED_FILE_TYPES,
} from "../db/repo";
import {
  FILE_KIND_LABELS,
  FILE_KIND_ORDER,
  ITEM_TYPE_LABELS,
  isBookType,
  itemTypeOf,
  type FileKind,
  type Pattern,
  type PatternFile,
} from "../db/types";
import { formatIsbn } from "../lib/isbn";
import { Cover, EmptyState, FavoriteButton, StatusBadge } from "../components/PatternParts";
import { ExternalLinkButton, FileKindSelect, StatusPicker, type PendingFile } from "../components/Inputs";
import { useFeedback } from "../components/Feedback";
import { PrintButton } from "../components/PrintButton";
import { CounterList, NotesEditor } from "../components/Counters";
import { formatBytes, formatDate, formatPrice, guessFileKind } from "../lib/format";
import { prepareFiles, readImage } from "../lib/importFiles";
import { inspectPdf } from "../lib/pdf";
import { canFetchUrlInfo, fetchImage, fetchPageInfo } from "../lib/fetchUrl";
import { saveOrShareFile } from "../lib/saveFile";
import { BACK_STATE, useGoBack } from "../hooks/navigation";

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
  const type = itemTypeOf(pattern);
  const isBook = isBookType(type);

  return (
    <div className="page detail">
      <header className="page-header">
        <BackButton />
        <h1 className="visually-hidden">{pattern.title}</h1>
        <Link className="btn btn-ghost" to={`/patterns/${id}/edit`} state={BACK_STATE}>
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
          {isBook && <span className="badge type-badge">{ITEM_TYPE_LABELS[type]}</span>}
          {!isBook && pattern.designer && <p className="muted">デザイン：{pattern.designer}</p>}
          {isBook && pattern.author && <p className="muted">著者：{pattern.author}</p>}
          {!isBook && pattern.sourceBookId && <SourceBook bookId={pattern.sourceBookId} page={pattern.sourcePage} />}
          {isBook ? <BookActions pattern={pattern} files={files} /> : <StartButton pattern={pattern} files={files} />}
        </div>
      </div>

      {!isBook && (
        <section className="section">
          <h3 className="section-title">制作ステータス</h3>
          <StatusChanger pattern={pattern} />
        </section>
      )}

      {isBook && <BookPatterns book={pattern} />}

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

      {!isBook && (
        <section className="section">
          <h3 className="section-title">段数カウンター</h3>
          <CounterList patternId={pattern.id} />
        </section>
      )}

      <section className="section">
        <h3 className="section-title">{isBook ? "メモ" : "制作メモ"}</h3>
        <NotesEditor
          key={pattern.id}
          patternId={pattern.id}
          initial={pattern.notes}
          placeholder={isBook ? "気になる作品のページ、買った書店、貸した相手など" : undefined}
        />
      </section>

      <DangerZone pattern={pattern} />
    </div>
  );
}

function BackButton() {
  const goBack = useGoBack("/library");
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={goBack}
    >
      ‹ 戻る
    </button>
  );
}

function StartButton({ pattern, files }: { pattern: Pattern; files: PatternFile[] }) {
  const navigate = useNavigate();
  const { showError } = useFeedback();
  const target = primaryFile(files);
  const open = () => target && navigate(`/patterns/${pattern.id}/files/${target.id}`, { state: BACK_STATE });
  const viewLabel = target?.mimeType === "application/pdf" ? "PDFを見る" : "ファイルを見る";
  const startLabel = pattern.status === "in_progress" ? "続きから編む" : pattern.status === "paused" ? "制作を再開する" : "制作を始める";
  const done = pattern.status === "done";
  return (
    <div className={`start-actions ${target && !done ? "two" : ""}`}>
      {!done && (
        <button
          type="button"
          className="btn btn-primary btn-start"
          onClick={async () => {
            try {
              if (pattern.status !== "in_progress") await setStatus(pattern.id, "in_progress");
              open();
            } catch (e) {
              showError(e);
            }
          }}
        >
          {startLabel}
          {!target && <small className="btn-sub">ステータスを「制作中」にします</small>}
        </button>
      )}
      {target && (
        // ステータスは変えずにファイルだけ開く
        <button type="button" className={`btn btn-start ${done ? "btn-primary" : "btn-view"}`} onClick={open}>
          {viewLabel}
          <small className="btn-sub">{target.name}</small>
        </button>
      )}
    </div>
  );
}

/** 本・電子書籍：電子書籍を開く／ファイルを見る */
function BookActions({ pattern, files }: { pattern: Pattern; files: PatternFile[] }) {
  const navigate = useNavigate();
  const target = primaryFile(files);
  if (!pattern.ebookUrl && !target) return null;
  return (
    <div className={`start-actions ${pattern.ebookUrl && target ? "two" : ""}`}>
      {pattern.ebookUrl && (
        <ExternalLinkButton url={pattern.ebookUrl} label="電子書籍を開く" pageName="電子書籍のページ" className="btn btn-primary btn-start" />
      )}
      {target && (
        <button
          type="button"
          className={`btn btn-start ${pattern.ebookUrl ? "btn-view" : "btn-primary"}`}
          onClick={() => navigate(`/patterns/${pattern.id}/files/${target.id}`, { state: BACK_STATE })}
        >
          {target.mimeType === "application/pdf" ? "PDFを見る" : "ファイルを見る"}
          <small className="btn-sub">{target.name}</small>
        </button>
      )}
    </div>
  );
}

/** 作品：掲載している本へのリンク */
function SourceBook({ bookId, page }: { bookId: string; page?: string }) {
  const book = useLiveQuery(() => db.patterns.get(bookId).then((b) => b ?? null), [bookId]);
  if (!book) return null;
  return (
    <p className="muted source-book">
      掲載：
      <Link to={`/patterns/${book.id}`} state={BACK_STATE} className="link">
        『{book.title}』
      </Link>
      {page ? ` ${/^\d+$/.test(page) ? `${page}ページ` : page}` : ""}
    </p>
  );
}

/** 本：この本に載っている作品 */
function BookPatterns({ book }: { book: Pattern }) {
  const items = useLiveQuery(() => db.patterns.filter((p) => p.sourceBookId === book.id).sortBy("title"), [book.id]);
  return (
    <section className="section">
      <h3 className="section-title">この本の作品</h3>
      {items && items.length > 0 ? (
        <ul className="book-patterns">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/patterns/${p.id}`} state={BACK_STATE} className="book-pattern">
                <Cover pattern={p} className="row-thumb" />
                <span className="row-body">
                  <span className="row-title">{p.title}</span>
                  <span className="row-meta">
                    <StatusBadge status={p.status} />
                    {p.sourcePage && <span className="muted small">{/^\d+$/.test(p.sourcePage) ? `${p.sourcePage}ページ` : p.sourcePage}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">この本に載っている作品を登録すると、ここに並びます。</p>
      )}
      <Link to={`/new?book=${book.id}`} state={BACK_STATE} className="btn btn-dashed">
        ＋ この本の作品を登録
      </Link>
    </section>
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

  const fromUrl = async () => {
    setOpen(false);
    if (!pattern.purchaseUrl) return;
    try {
      toast("購入先ページから画像を読み込んでいます…");
      const info = await fetchPageInfo(pattern.purchaseUrl);
      const img = info.imageUrl ? await fetchImage(info.imageUrl) : undefined;
      if (!img) {
        toast("購入先ページに使える画像が見つかりませんでした。端末から画像を選んでください。", "error");
        return;
      }
      await setPatternCover(pattern.id, await readImage(img));
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
          {pattern.purchaseUrl && canFetchUrlInfo() && (
            <button role="menuitem" onClick={fromUrl}>
              購入先ページの画像を使う
            </button>
          )}
          <button role="menuitem" onClick={() => (setOpen(false), input.current?.click())}>
            端末から画像を選ぶ
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

/**
 * 追加するファイルの種類を推測する。ファイル名で分からないときは、
 * すでに英語原本があれば日本語翻訳版とみなす（原本に日本語訳を足すことが多いため）。
 */
export function kindForNewFile(name: string, mimeType: string, existing: Pick<PatternFile, "kind">[]): FileKind {
  if (mimeType.startsWith("image/")) return "chart";
  const guessed = guessFileKind(name);
  if (guessed === "original" && existing.some((f) => f.kind === "original")) return "translation";
  return guessed;
}

function FilesSection({ pattern, files }: { pattern: Pattern; files: PatternFile[] }) {
  const { toast, showError } = useFeedback();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const groups = FILE_KIND_ORDER.map((k) => [k, files.filter((f) => f.kind === k)] as const).filter(([, l]) => l.length);

  // ファイルを選んだらすぐに保存する（「追加する」ボタンの押し忘れで消えないように）
  const add = async (picked: File[]) => {
    if (!picked.length) return;
    setBusy(true);
    try {
      const known = [...files];
      const pending: PendingFile[] = picked.map((file, i) => {
        const kind = kindForNewFile(file.name, file.type, known);
        known.push({ kind } as PatternFile);
        return { key: `add${Date.now()}-${i}`, file, kind };
      });
      const prepared = await prepareFiles(pending, { thumbnail: !pattern.coverBlobId });
      await addFilesToPattern(pattern.id, prepared.inputs);
      if (prepared.thumbnail && !pattern.coverBlobId) await setPatternCover(pattern.id, prepared.thumbnail);
      prepared.warnings.forEach((w) => toast(w, "error"));
      const kinds = [...new Set(pending.map((p) => FILE_KIND_LABELS[p.kind]))].join("・");
      toast(`「${kinds}」として追加しました。種類は各ファイルの「⋯」から変えられます`);
    } catch (e) {
      showError(e, "ファイルを追加できませんでした。端末の空き容量を確認して、もう一度お試しください。");
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
        <button type="button" className="btn btn-dashed" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "追加中…" : "＋ PDF・画像を追加（日本語訳・修正版など）"}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          hidden
          aria-label="追加するファイル"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            void add(picked);
          }}
        />
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
      <Link to={`/patterns/${file.patternId}/files/${file.id}`} state={BACK_STATE} className="file-open">
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
      <ShareFileButton file={file} />
      <PrintButton file={file} className="share-btn">
        印刷
      </PrintButton>
      <button type="button" className="icon-btn" aria-label={`${file.name} の名前・種別を変更`} onClick={() => setEditing(true)}>
        ⋯
      </button>
    </li>
  );
}

/** 登録したファイルを、共有シートから「ファイル」に保存したり、ほかのアプリで開いたりする */
function ShareFileButton({ file }: { file: PatternFile }) {
  const { showError, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="share-btn"
      disabled={busy}
      aria-label={`${file.name} をほかのアプリで開く・保存する`}
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await getBlob(file.blobId);
          if (!blob) throw new UserFacingError("ファイルの本体が見つかりません。バックアップから復元するか、ファイルを登録し直してください。");
          const r = await saveOrShareFile(blob, exportFileName(file));
          if (r === "downloaded") toast("ファイルをダウンロードしました");
        } catch (e) {
          showError(e, "ファイルを共有できませんでした。もう一度お試しください。");
        } finally {
          setBusy(false);
        }
      }}
    >
      共有
    </button>
  );
}

/** 書き出すときのファイル名（使えない文字を除き、拡張子を補う） */
export function exportFileName(file: Pick<PatternFile, "name" | "mimeType">): string {
  const ext = file.mimeType === "application/pdf" ? ".pdf" : file.mimeType === "image/png" ? ".png" : file.mimeType === "image/jpeg" ? ".jpg" : "";
  // eslint-disable-next-line no-control-regex
  let name = file.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "file";
  if (ext && !name.toLowerCase().endsWith(ext) && !(ext === ".jpg" && /\.jpe?g$/i.test(name))) name += ext;
  return name;
}

function PurchaseInfo({ pattern }: { pattern: Pattern }) {
  const rows: [string, string | undefined][] = [
    ["著者", pattern.author],
    ["出版社", pattern.publisher],
    ["ISBN", pattern.isbn ? formatIsbn(pattern.isbn) : undefined],
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
          const isBook = isBookType(itemTypeOf(pattern));
          const ok = await confirm({
            title: `この${isBook ? "本" : "作品"}を削除しますか？`,
            message: (
              <>
                <p className="break">「{pattern.title}」</p>
                <p>
                  作品情報{parts.length ? `と、${parts.join("・")}` : ""}が端末から削除されます。元に戻せません。
                </p>
                {s.linkedPatterns > 0 && <p>この本に結び付いている作品{s.linkedPatterns}件は削除されず、掲載している本の情報だけが外れます。</p>}
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
        {isBookType(itemTypeOf(pattern)) ? "この本を削除" : "この作品を削除"}
      </button>
    </section>
  );
}
