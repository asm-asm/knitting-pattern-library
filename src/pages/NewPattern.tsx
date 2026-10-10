import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPattern, type ImageInput } from "../db/repo";
import { FileSelection, type PendingFile } from "../components/Inputs";
import { useFeedback } from "../components/Feedback";
import { prepareFiles, readImage, requestPersistentStorage } from "../lib/importFiles";
import { stripExtension } from "../lib/format";
import { Field, PatternFields, emptyValues, valuesToInput } from "./PatternForm";
import { clearHandoff, peekHandoff } from "./Import";
import { fetchImage } from "../lib/fetchUrl";
import { BACK_STATE } from "../hooks/navigation";

export default function NewPattern() {
  const navigate = useNavigate();
  const { toast, showError } = useFeedback();
  // 共有メニューから受け取ったファイルがあれば引き継ぐ
  const [files, setFiles] = useState<PendingFile[]>(peekHandoff);
  const [values, setValues] = useState(() => {
    const v = emptyValues();
    const first = peekHandoff()[0];
    return first ? { ...v, title: stripExtension(first.file.name) } : v;
  });
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
      const input = valuesToInput(values);
      const prepared = await prepareFiles(files, { thumbnail: !coverFile && pdfCover });
      let cover: ImageInput | undefined = prepared.thumbnail;
      if (coverFile) cover = await readImage(coverFile);
      const id = await createPattern(input, prepared.inputs, cover);
      void requestPersistentStorage();
      prepared.warnings.forEach((w) => toast(w, "error"));
      toast("作品を登録しました");
      navigate(`/patterns/${id}`, { replace: true, state: BACK_STATE });
    } catch (err) {
      showError(err, "登録できませんでした。入力内容を確認して、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="page form" onSubmit={submit}>
      <header className="page-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          キャンセル
        </button>
        <h1>作品を登録</h1>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
      </header>

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
        extraBasic={
          <>
            <Field label="ファイル（PDF・画像）" hint="英語原本と日本語版など、複数のファイルを1つの作品にまとめられます。URLだけ・ファイルだけの登録もできます。">
              <FileSelection value={files} onChange={onFiles} />
            </Field>
            <Field label="表紙画像">
              <div className="cover-pick">
                {coverPreview && <img className="cover-preview" src={coverPreview} alt="表紙画像" />}
                <div className="cover-pick-actions">
                  {loadingCover && <span className="small muted">URLから画像を読み込み中…</span>}
                  {coverFile && coverFromUrl && <span className="small muted">購入先ページの画像</span>}
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
