import { useRef, useState } from "react";
import { useFeedback } from "./Feedback";
import { backupFileName, createBackup, parseBackup, restoreBackup, wipeAllData, type ParsedBackup, type RestoreMode } from "../lib/backup";
import { formatBytes, formatDateTime } from "../lib/format";
import { usePersistentState } from "../hooks/hooks";
import { isNativeApp, shareFileNative } from "../lib/native";

/**
 * 作成したファイルを端末に保存する。
 * iOS などでは共有シート（「"ファイル"に保存」など）、それ以外はダウンロード。
 * 共有シートはタップ直後でないと開けないため、作成とは別のボタン操作から呼ぶ。
 */
async function saveFile(blob: Blob, filename: string): Promise<"shared" | "downloaded" | "cancelled"> {
  // iOS アプリ：WebView ではダウンロードできないため、ネイティブの共有シートを使う
  if (isNativeApp()) return shareFileNative(blob, filename);
  const file = new File([blob], filename, { type: blob.type });
  const touch = navigator.maxTouchPoints > 0;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // 共有できない場合はダウンロードにフォールバック
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}

export function BackupSettings() {
  const { confirm, toast, showError } = useFeedback();
  const [lastBackup, setLastBackup] = usePersistentState<number | null>("kpl.lastBackupAt", null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState<{ blob: Blob; filename: string; includeFiles: boolean } | null>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const build = async (includeFiles: boolean) => {
    setBusy(includeFiles ? "完全バックアップを作成中…" : "データを書き出し中…");
    setReady(null);
    try {
      const blob = await createBackup({ includeFiles });
      setReady({ blob, filename: backupFileName(includeFiles), includeFiles });
    } catch (e) {
      showError(e, "バックアップを作成できませんでした。端末の空き容量を確認して、もう一度お試しください。");
    } finally {
      setBusy(null);
    }
  };

  const restore = async (mode: RestoreMode) => {
    if (!pending) return;
    if (mode === "replace") {
      const ok = await confirm({
        title: "本当にすべて置き換えますか？",
        message: "現在この端末にある作品・PDF・カウンター・書き込みはすべて削除され、バックアップの内容に置き換わります。元に戻せません。",
        confirmLabel: "置き換える",
        danger: true,
      });
      if (!ok) return;
    }
    const parsed = pending;
    setPending(null);
    setBusy("復元中…");
    try {
      const r = await restoreBackup(parsed, mode);
      const parts = [`作品${r.patterns}件`, `ファイル${r.files}件を復元しました。`];
      if (r.skipped) parts.push(`すでに登録済みの作品${r.skipped}件は取り込みませんでした。`);
      if (r.missingFiles) parts.push(`PDF本体が含まれていないファイル${r.missingFiles}件は取り込めませんでした。`);
      toast(parts.join(""));
    } catch (e) {
      showError(e, "復元できませんでした。端末内のデータは変更されていません。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section">
      <h2 className="section-title">バックアップと復元</h2>
      <p className="hint">
        データはこの端末の中だけに保存されています。端末の故障や機種変更、アプリの削除に備えて、定期的にバックアップを作成し、「ファイル」アプリやパソコンなどに保管してください。
      </p>
      <p className="small">最後のバックアップ：{lastBackup ? formatDateTime(lastBackup) : "まだ作成していません"}</p>

      <div className="backup-actions">
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => build(true)}>
          完全バックアップを作成（PDF・画像を含む）
        </button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => build(false)}>
          データのみ書き出す（JSON）
        </button>
        <p className="hint">「データのみ」には作品情報・カウンター・メモ・書き込みが含まれますが、<strong>PDF本体と表紙画像は含まれません</strong>。</p>
      </div>

      {busy && <p className="busy" aria-live="polite">{busy}</p>}

      {ready && (
        <div className="note-box ready-box">
          <p>
            <strong>{ready.filename}</strong>（{formatBytes(ready.blob.size)}）を作成しました。
            {!ready.includeFiles && " PDF本体は含まれていません。"}
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                let r: Awaited<ReturnType<typeof saveFile>>;
                try {
                  r = await saveFile(ready.blob, ready.filename);
                } catch (e) {
                  showError(e, "ファイルを保存できませんでした。端末の空き容量を確認して、もう一度お試しください。");
                  return;
                }
                if (r === "cancelled") return;
                if (ready.includeFiles) setLastBackup(Date.now());
                setReady(null);
                toast(r === "shared" ? "バックアップを保存しました" : "バックアップをダウンロードしました");
              }}
            >
              ファイルを保存
            </button>
            <button type="button" className="btn" onClick={() => setReady(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="backup-actions">
        <button type="button" className="btn" disabled={!!busy} onClick={() => input.current?.click()}>
          バックアップから復元…
        </button>
        <input
          ref={input}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy("バックアップを読み込み中…");
            try {
              setPending(await parseBackup(f));
            } catch (err) {
              showError(err, "バックアップを読み込めませんでした。");
            } finally {
              setBusy(null);
            }
          }}
        />
      </div>

      {pending && <RestoreDialog parsed={pending} onCancel={() => setPending(null)} onRestore={restore} />}

      <DangerWipe />
    </section>
  );
}

function RestoreDialog({ parsed, onCancel, onRestore }: { parsed: ParsedBackup; onCancel: () => void; onRestore: (m: RestoreMode) => void }) {
  const c = parsed.manifest.counts;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="restore-title">バックアップから復元</h2>
        <div className="modal-body">
          <p>作成日時：{formatDateTime(parsed.manifest.createdAt)}</p>
          <p>
            作品{parsed.data.patterns.length}件・ファイル{c?.files ?? parsed.data.files.length}件・カウンター{parsed.data.counters.length}件
          </p>
          {!parsed.manifest.includesFiles && (
            <p className="warn">このバックアップには PDF本体と表紙画像が含まれていません。作品情報・カウンター・メモのみ復元されます。</p>
          )}
          {parsed.invalid > 0 && <p className="warn">読み込めないデータが{parsed.invalid}件あったため、読み飛ばします。</p>}
          <p className="muted small">「追加で復元」は、この端末にまだない作品だけを追加します。すでにある作品は変更しません。</p>
        </div>
        <div className="modal-actions stack">
          <button type="button" className="btn btn-primary" onClick={() => onRestore("merge")}>
            追加で復元
          </button>
          <button type="button" className="btn btn-danger-text" onClick={() => onRestore("replace")}>
            すべて置き換えて復元
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

function DangerWipe() {
  const { confirm, toast, showError } = useFeedback();
  return (
    <div className="danger-zone wipe">
      <button
        type="button"
        className="btn btn-danger-text"
        onClick={async () => {
          const ok1 = await confirm({
            title: "すべてのデータを削除しますか？",
            message: "この端末に保存されているすべての作品・PDF・カウンター・メモ・書き込み・カテゴリが削除されます。必要な場合は、先に完全バックアップを作成してください。",
            confirmLabel: "次へ",
            danger: true,
          });
          if (!ok1) return;
          const ok2 = await confirm({ title: "最終確認", message: "削除したデータは元に戻せません。本当に削除しますか？", confirmLabel: "すべて削除", danger: true });
          if (!ok2) return;
          try {
            await wipeAllData();
            toast("すべてのデータを削除しました");
          } catch (e) {
            showError(e);
          }
        }}
      >
        すべてのデータを削除
      </button>
    </div>
  );
}
