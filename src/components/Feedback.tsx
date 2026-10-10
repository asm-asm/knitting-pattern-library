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

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

interface FeedbackApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
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
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })),
    [],
  );
  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);
  const showError = useCallback((e: unknown, fallback?: string) => toast(errorMessage(e, fallback), "error"), [toast]);

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ confirm, toast, showError }}>
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

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (v: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={() => onClose(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title">{options.title}</h2>
        {options.message && <div className="modal-body">{options.message}</div>}
        <div className="modal-actions">
          <button ref={cancelRef} className="btn" onClick={() => onClose(false)}>
            {options.cancelLabel ?? "キャンセル"}
          </button>
          <button className={`btn ${options.danger ? "btn-danger" : "btn-primary"}`} onClick={() => onClose(true)}>
            {options.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
