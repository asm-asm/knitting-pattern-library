import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPattern, type ImageInput } from "../db/repo";
import { FileSelection, type PendingFile } from "../components/Inputs";
import { useFeedback } from "../components/Feedback";
import { prepareFiles, readImage, requestPersistentStorage } from "../lib/importFiles";
import { stripExtension } from "../lib/format";
import { Field, PatternFields, emptyValues, valuesToInput } from "./PatternForm";
import { clearHandoff, peekHandoff } from "./Import";
import { fetchImage } from "../lib/fetchUrl";
import { BACK_STATE } from "../hooks/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { Paywall, usePremium } from "../components/Paywall";
import { canAddBook, canAddPattern, countByKind, FREE_BOOK_LIMIT, FREE_PATTERN_LIMIT } from "../lib/premium";
import { ITEM_TYPE_LABELS, isBookType, type ItemType } from "../db/types";
import { UserFacingError } from "../db/repo";

export default function NewPattern() {
  const navigate = useNavigate();
  const { toast, showError } = useFeedback();
  // 共有メニューから受け取ったファイルがあれば引き継ぐ
  const [files, setFiles] = useState<PendingFile[]>(peekHandoff);
  // ?type=book|ebook で種類を、?book=<id> で掲載している本を指定して開ける
  const [params] = useSearchParams();
  const [values, setValues] = useState(() => {
    const t = params.get("type");
    const v = emptyValues(t === "book" || t === "ebook" ? t : "pattern");
    const book = params.get("book");
    if (book && v.itemType === "pattern") v.sourceBookId = book;
    const first = peekHandoff()[0];
    return first ? { ...v, title: stripExtension(first.file.name) } : v;
  });
  const isBook = isBookType(values.itemType);
  const noun = isBook ? "本" : "作品";
  useEffect(() => clearHandoff(), []);
  const [coverFile, setCoverFile] = useState<File>();
  // URL から取得した表紙か（自分で選んだ画像は URL の画像で置き換えない）
  const [coverFromUrl, setCoverFromUrl] = useState(false);
  const [loadingCover, setLoadingCover] = useState(false);
  const coverPreview = useMemo(() => (coverFile ? URL.createObjectURL(coverFile) : undefined), [coverFile]);
  useEffect(() => () => void (coverPreview && URL.revokeObjectURL(coverPreview)), [coverPreview]);
  const autoTitle = files[0] ? stripExtension(files[0].file.name) : undefined;
  const [pdfCover, setPdfCover] = useState(true);
  const [busy, setBusy] = useState(false);
  const counts = useLiveQuery(async () => countByKind(await db.patterns.toArray()), []);
  const premium = usePremium();
  const canAdd = (c: { patterns: number; books: number }) => (isBook ? canAddBook(c.books, premium.active) : canAddPattern(c.patterns, premium.active));
  const limited = premium.enforced && counts !== undefined && !canAdd(counts);
  const coverInput = useRef<HTMLInputElement>(null);
  const hasPdf = files.some((f) => f.file.type === "application/pdf" || f.file.name.toLowerCase().endsWith(".pdf"));

  const onFiles = (next: PendingFile[]) => {
    setFiles(next);
    // PDF だけで登録する場合に備えて、タイトルが空ならファイル名を候補にする
    if (!values.title && next.length) setValues((v) => ({ ...v, title: stripExtension(next[0].file.name) }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      // 念のため保存直前にも上限を確認する
      if (premium.enforced && !canAdd(countByKind(await db.patterns.toArray()))) {
        throw new UserFacingError(
          isBook
            ? `無料版で登録できる本・電子書籍は${FREE_BOOK_LIMIT}冊までです。プレミアムに登録するか、本を整理してください。`
            : `無料版で登録できる作品は${FREE_PATTERN_LIMIT}件までです。プレミアムに登録するか、作品を整理してください。`,
        );
      }
      const input = valuesToInput(values);
      const prepared = await prepareFiles(files, { thumbnail: !coverFile && pdfCover });
      let cover: ImageInput | undefined = prepared.thumbnail;
      if (coverFile) cover = await readImage(coverFile);
      const id = await createPattern(input, prepared.inputs, cover);
      void requestPersistentStorage();
      prepared.warnings.forEach((w) => toast(w, "error"));
      toast(`${isBook ? ITEM_TYPE_LABELS[values.itemType] : "作品"}を登録しました`);
      navigate(`/patterns/${id}`, { replace: true, state: BACK_STATE });
    } catch (err) {
      showError(err, "登録できませんでした。入力内容を確認して、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  const typeSelector = (
    <div className="type-tabs" role="tablist" aria-label="登録する種類">
      {(["pattern", "book", "ebook"] as ItemType[]).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={values.itemType === t}
          className={values.itemType === t ? "on" : ""}
          onClick={() => setValues((v) => ({ ...v, itemType: t }))}
        >
          {ITEM_TYPE_LABELS[t]}
        </button>
      ))}
    </div>
  );

  if (limited) {
    // 上限に達したとき：入力内容（共有メニューから受け取ったファイルも含む）は保ったまま、案内を表示する
    return (
      <div className="page form">
        <header className="page-header">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            戻る
          </button>
          <h1>{noun}を登録</h1>
          <span style={{ width: 56 }} />
        </header>
        {typeSelector}
        <Paywall reason="limit" kind={isBook ? "book" : "pattern"} patternCount={isBook ? counts?.books : counts?.patterns} />
      </div>
    );
  }

  return (
    <form className="page form" onSubmit={submit}>
      <header className="page-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          キャンセル
        </button>
        <h1>{noun}を登録</h1>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
      </header>
      {typeSelector}

      <PatternFields
        values={values}
        onChange={setValues}
        autoFetch
        replaceableTitle={autoTitle}
        onUrlInfo={async (info) => {
          if (!info.imageUrl || (coverFile && !coverFromUrl)) return;
          setLoadingCover(true);
          const img = await fetchImage(info.imageUrl);
          setLoadingCover(false);
          if (img) {
            setCoverFile(img);
            setCoverFromUrl(true);
          }
        }}
        onCoverUrl={async (url) => {
          if (coverFile && !coverFromUrl) return;
          setLoadingCover(true);
          const img = await fetchImage(url);
          setLoadingCover(false);
          if (img) {
            setCoverFile(img);
            setCoverFromUrl(true);
          }
        }}
        extraBasic={
          <>
            <Field
              label={isBook ? "ファイル（任意）" : "ファイル（PDF・画像）"}
              hint={
                isBook
                  ? "コピー防止のない電子書籍のPDFや、本のページを撮った画像などを入れておけます。選んだファイルはアプリ内にコピーして保存します。"
                  : "英語原本と日本語版など、複数のファイルを1つの作品にまとめられます。URLだけ・ファイルだけの登録もできます。選んだファイルはアプリ内にコピーして保存するので、登録後に元のファイルを削除しても大丈夫です。"
              }
            >
              <FileSelection value={files} onChange={onFiles} />
            </Field>
            <Field label="表紙画像">
              <div className="cover-pick">
                {coverPreview && <img className="cover-preview" src={coverPreview} alt="表紙画像" />}
                <div className="cover-pick-actions">
                  {loadingCover && <span className="small muted">表紙画像を読み込み中…</span>}
                  {coverFile && coverFromUrl && <span className="small muted">{isBook ? "本の情報から取得した表紙" : "購入先ページの画像"}</span>}
                  <button type="button" className="btn" onClick={() => coverInput.current?.click()}>
                    {coverFile ? "別の画像を選ぶ" : "端末から画像を選ぶ"}
                  </button>
                  {coverFile && (
                    <button
                      type="button"
                      className="btn btn-danger-text"
                      onClick={() => {
                        setCoverFile(undefined);
                        setCoverFromUrl(false);
                      }}
                    >
                      表紙を外す
                    </button>
                  )}
                </div>
                <input
                  ref={coverInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    setCoverFile(f);
                    setCoverFromUrl(false);
                  }}
                />
              </div>
              {!coverFile && hasPdf && (
                <label className="check">
                  <input type="checkbox" checked={pdfCover} onChange={(e) => setPdfCover(e.target.checked)} />
                  PDFの1ページ目を表紙にする
                </label>
              )}
            </Field>
          </>
        }
      />
      <div className="form-footer">
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "保存中…" : "この内容で登録する"}
        </button>
      </div>
    </form>
  );
}
