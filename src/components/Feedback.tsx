// 確認ダイアログとトースト通知。ブラウザ標準の confirm/alert は使わない（iOS WebView で体験が悪いため）。
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { UserFacingError } from "../db/repo";

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** choose の結果。dismiss は「キャンセル」・背景のタップ・Esc で閉じたとき */
export type Choice = "confirm" | "alternative" | "dismiss";

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

interface FeedbackApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  /** 2つの選択肢（confirmLabel / cancelLabel）と「キャンセル」を出す */
  choose: (o: ConfirmOptions) => Promise<Choice>;
  toast: (message: string, tone?: Toast["tone"]) => void;
  /** 例外を日本語メッセージで通知する */
  showError: (e: unknown, fallback?: string) => void;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("FeedbackProvider がありません");
  return v;
}

export function errorMessage(e: unknown, fallback = "処理に失敗しました。もう一度お試しください。"): string {
  if (e instanceof UserFacingError) return e.message;
  const name = (e as { name?: string })?.name;
  if (name === "QuotaExceededError" || (e as { inner?: { name?: string } })?.inner?.name === "QuotaExceededError") {
    return "端末の空き容量が不足しています。不要なファイルを削除してから、もう一度お試しください。";
  }
  console.error(e);
  return fallback;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { three: boolean; resolve: (v: Choice) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...o, three: false, resolve: (v) => resolve(v === "confirm") })),
    [],
  );
  const choose = useCallback((o: ConfirmOptions) => new Promise<Choice>((resolve) => setDialog({ ...o, three: true, resolve })), []);
  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);
  const showError = useCallback((e: unknown, fallback?: string) => toast(errorMessage(e, fallback), "error"), [toast]);

  const close = (v: Choice) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ confirm, choose, toast, showError }}>
      {children}
      {dialog && <ConfirmDialog options={dialog} onClose={close} />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions & { three: boolean }; onClose: (v: Choice) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose("dismiss");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={() => onClose("dismiss")}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title">{options.title}</h2>
        {options.message && <div className="modal-body">{options.message}</div>}
        <div className={`modal-actions ${options.three ? "three" : ""}`}>
          {options.three ? (
            <>
              <button ref={cancelRef} className="btn btn-ghost" onClick={() => onClose("dismiss")}>
                キャンセル
              </button>
              <button className="btn" onClick={() => onClose("alternative")}>
                {options.cancelLabel}
              </button>
            </>
          ) : (
            <button ref={cancelRef} className="btn" onClick={() => onClose("dismiss")}>
              {options.cancelLabel ?? "キャンセル"}
            </button>
          )}
          <button className={`btn ${options.danger ? "btn-danger" : "btn-primary"}`} onClick={() => onClose("confirm")}>
            {options.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
