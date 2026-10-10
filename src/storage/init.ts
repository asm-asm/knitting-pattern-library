// iOS アプリ起動時の保存先の準備（ブラウザ版では何もしない）
//  1. ファイル実体の保存先をアプリ専用フォルダにする（移行前の古い実体も読めるようにする）
//  2. データベースが失われていたら、控えから自動で復元する
//  3. 控えの自動保存を開始する
//  4. 古い保存先に残っているファイル実体を、裏で少しずつ移す
import { db } from "../db/db";
import { isNativeApp } from "../lib/native";
import { FallbackBlobStore, IdbBlobStore, migrateBlobs, registerBlobStore } from "./blobStore";
import { recoverFromSnapshot, SnapshotWriter, type RecoveryResult, type SnapshotIO } from "./snapshot";

let writer: SnapshotWriter | undefined;

/** 設定画面に表示する保存状況 */
export function snapshotLastSavedAt(): number | undefined {
  return writer?.lastSavedAt;
}

/** 全データ削除の直後などに、控えをすぐ更新する */
export function flushSnapshot() {
  return writer?.flush() ?? Promise.resolve();
}

export async function initStorage(): Promise<{ recovered?: RecoveryResult }> {
  if (!isNativeApp()) return {};
  const [{ NativeBlobStore, NATIVE_ROOT }, { Directory, Encoding, Filesystem }, { App }] = await Promise.all([
    import("./nativeBlobStore"),
    import("@capacitor/filesystem"),
    import("@capacitor/app"),
  ]);

  const native = new NativeBlobStore();
  registerBlobStore(db, new FallbackBlobStore(native, new IdbBlobStore(db)));

  const io: SnapshotIO = {
    async read(slot) {
      try {
        const r = await Filesystem.readFile({ path: `${NATIVE_ROOT}/snapshot-${slot}.json`, directory: Directory.Library, encoding: Encoding.UTF8 });
        return typeof r.data === "string" ? r.data : undefined;
      } catch {
        return undefined;
      }
    },
    async write(slot, text) {
      await Filesystem.writeFile({
        path: `${NATIVE_ROOT}/snapshot-${slot}.json`,
        directory: Directory.Library,
        encoding: Encoding.UTF8,
        data: text,
        recursive: true,
      });
    },
  };

  // 控えの監視を始める前に復元する（空の状態で控えを上書きしないため）
  let recovered: RecoveryResult | undefined;
  try {
    recovered = await recoverFromSnapshot(db, io);
  } catch (e) {
    console.warn("recovery failed", e);
  }

  writer = new SnapshotWriter(db, io);
  await writer.start();
  void writer.flush(true); // 既存の利用者にも、最初の控えをすぐ作る

  // アプリが裏に回るときに未保存の控えを書き出す
  void App.addListener("pause", () => void writer?.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void writer?.flush();
  });

  // 古い保存先からの移行（読み込みは FallbackBlobStore が両方を見るので、終わるのを待たない）
  void migrateBlobs(db, native).catch((e) => console.warn("migration failed", e));

  return { recovered };
}
