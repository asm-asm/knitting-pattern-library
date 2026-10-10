import { useEffect, useState } from "react";
import { getBlob } from "../db/repo";

/** blobs テーブルの実体を object URL として取得する（アンマウント時に解放） */
export function useBlobUrl(blobId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blobId) {
      setUrl(undefined);
      return;
    }
    let cancelled = false;
    let created: string | undefined;
    getBlob(blobId).then((b) => {
      if (cancelled || !b) return;
      created = URL.createObjectURL(b);
      setUrl(created);
    });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [blobId]);
  return url;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** 表示形式などの端末ごとの設定を保存する。ストレージが使えない環境でも動作する。 */
export function usePersistentState<T>(key: string, initial: T, storage: "local" | "session" = "local") {
  const [value, setValue] = useState<T>(() => {
    try {
      const s = (storage === "local" ? localStorage : sessionStorage).getItem(key);
      if (!s) return initial;
      const parsed = JSON.parse(s) as T;
      // オブジェクトの場合は後から追加された項目に初期値を補う
      return initial && typeof initial === "object" && !Array.isArray(initial) ? { ...initial, ...parsed } : parsed;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      (storage === "local" ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できなくても動作は継続 */
    }
  }, [key, value, storage]);
  return [value, setValue] as const;
}
