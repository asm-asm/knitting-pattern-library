import { useRef, useState } from "react";
import type { Category, FileKind } from "../db/types";
import { FILE_KIND_LABELS, FILE_KIND_ORDER, STATUS_LABELS, STATUS_ORDER, type PatternStatus } from "../db/types";
import { ACCEPTED_FILE_TYPES } from "../db/repo";
import { formatBytes, guessFileKind } from "../lib/format";
import { useFeedback } from "./Feedback";
import { useOnline } from "../hooks/hooks";

/** 購入先などの外部URLを開く。外部サイトへ移動することを事前に確認する。 */
export function ExternalLinkButton({ url, label = "購入先を開く" }: { url: string; label?: string }) {
  const { confirm } = useFeedback();
  const online = useOnline();
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* 表示用なので失敗しても URL をそのまま使う */
  }
  return (
    <button
      type="button"
      className="btn btn-link-ext"
      onClick={async () => {
        const ok = await confirm({
          title: "外部サイトを開きます",
          message: (
            <>
              <p className="break">{host}</p>
              <p>ブラウザで購入先のページを開きます。{online ? "" : "現在オフラインのため、ページが表示されない可能性があります。"}</p>
            </>
          ),
          confirmLabel: "開く",
        });
        if (ok) window.open(url, "_blank", "noopener,noreferrer");
      }}
    >
      {label} ↗
    </button>
  );
}

export function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft.split(/[,、\s]+/).map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft("");
  };
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="tag">
          #{t}
          <button type="button" aria-label={`タグ「${t}」を削除`} onClick={() => onChange(value.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={value.length ? "" : "例：ラグラン、モヘア"}
        enterKeyHint="done"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export function StatusPicker({ value, onChange }: { value: PatternStatus; onChange: (s: PatternStatus) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="制作ステータス">
      {STATUS_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          className={`chip status-chip status-${s} ${value === s ? "on" : ""}`}
          onClick={() => onChange(s)}
        >
          {STATUS_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!categories.length) return <p className="hint">カテゴリは「設定」から追加できます。</p>;
  return (
    <div className="chips">
      {categories.map((c) => {
        const on = value.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            className={`chip ${on ? "on" : ""}`}
            onClick={() => onChange(on ? value.filter((x) => x !== c.id) : [...value, c.id])}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

export function FileKindSelect({ value, onChange, id }: { value: FileKind; onChange: (k: FileKind) => void; id?: string }) {
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as FileKind)}>
      {FILE_KIND_ORDER.map((k) => (
        <option key={k} value={k}>
          {FILE_KIND_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

export interface PendingFile {
  key: string;
  file: File;
  kind: FileKind;
}

let pendingSeq = 0;

/** 登録前のファイル一覧。種別（原本・翻訳版など）を1件ずつ選べる。 */
export function FileSelection({ value, onChange }: { value: PendingFile[]; onChange: (v: PendingFile[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="file-selection">
      {value.length > 0 && (
        <ul className="pending-files">
          {value.map((p) => (
            <li key={p.key}>
              <div className="pending-name">
                <span className="break">{p.file.name}</span>
                <small>{formatBytes(p.file.size)}</small>
              </div>
              <FileKindSelect
                value={p.kind}
                onChange={(kind) => onChange(value.map((x) => (x.key === p.key ? { ...x, kind } : x)))}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`${p.file.name} を取り消す`}
                onClick={() => onChange(value.filter((x) => x.key !== p.key))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-dashed" onClick={() => inputRef.current?.click()}>
        ＋ PDF・画像を選ぶ
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          onChange([
            ...value,
            ...files.map((file) => ({
              key: `p${++pendingSeq}`,
              file,
              kind: file.type.startsWith("image/") ? ("chart" as FileKind) : guessFileKind(file.name),
            })),
          ]);
        }}
      />
    </div>
  );
}
