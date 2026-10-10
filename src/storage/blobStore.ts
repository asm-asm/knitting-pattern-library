// ファイル実体（PDF・画像・表紙）の保存先。
// ブラウザ版：IndexedDB の blobs テーブル
// iOS アプリ版：アプリ専用フォルダ（Library）。iOS に勝手に消されず、iCloud バックアップにも含まれる。
import type { LibraryDB } from "../db/db";

export interface BlobStore {
  put(id: string, data: ArrayBuffer, type?: string): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  has(id: string): Promise<boolean>;
  delete(ids: string[]): Promise<void>;
  /** すべての実体を削除する（全データ削除用） */
  clear(): Promise<void>;
}

/** 先頭のバイト列から種類を判定する（保存時に種類を持たない保存先のため） */
export function sniffType(bytes: Uint8Array): string {
  const at = (i: number, ...v: number[]) => v.every((b, j) => bytes[i + j] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  // PDF ヘッダは先頭 1024 バイト以内
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) if (at(i, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return "application/octet-stream";
}

export class IdbBlobStore implements BlobStore {
  constructor(private db: LibraryDB) {}
  async put(id: string, data: ArrayBuffer, type?: string) {
    await this.db.blobs.put({ id, type: type ?? sniffType(new Uint8Array(data)), data });
  }
  async get(id: string) {
    const b = await this.db.blobs.get(id);
    return b ? new Blob([b.data], { type: b.type }) : undefined;
  }
  async has(id: string) {
    return (await this.db.blobs.where("id").equals(id).count()) > 0;
  }
  async delete(ids: string[]) {
    if (ids.length) await this.db.blobs.bulkDelete(ids);
  }
  async clear() {
    await this.db.blobs.clear();
  }
}

/** テスト用：ネイティブの保存先の代わり */
export class MemoryBlobStore implements BlobStore {
  files = new Map<string, Uint8Array>();
  async put(id: string, data: ArrayBuffer) {
    this.files.set(id, new Uint8Array(data.slice(0)));
  }
  async get(id: string) {
    const d = this.files.get(id);
    return d ? new Blob([d as BlobPart], { type: sniffType(d) }) : undefined;
  }
  async has(id: string) {
    return this.files.has(id);
  }
  async delete(ids: string[]) {
    ids.forEach((id) => this.files.delete(id));
  }
  async clear() {
    this.files.clear();
  }
}

/**
 * 移行期間用：新しい保存先を優先し、見つからなければ以前の保存先（IndexedDB）から読む。
 * 移行が途中で中断されても、ファイルが読めなくなることはない。
 */
export class FallbackBlobStore implements BlobStore {
  constructor(
    private primary: BlobStore,
    private legacy: BlobStore,
  ) {}
  put(id: string, data: ArrayBuffer, type?: string) {
    return this.primary.put(id, data, type);
  }
  async get(id: string) {
    return (await this.primary.get(id)) ?? (await this.legacy.get(id));
  }
  async has(id: string) {
    return (await this.primary.has(id)) || (await this.legacy.has(id));
  }
  async delete(ids: string[]) {
    await this.primary.delete(ids);
    await this.legacy.delete(ids);
  }
  async clear() {
    await this.primary.clear();
    await this.legacy.clear();
  }
}

const registry = new WeakMap<LibraryDB, BlobStore>();

/** そのデータベースで使う保存先を設定する（アプリ起動時・テスト用） */
export function registerBlobStore(db: LibraryDB, store: BlobStore) {
  registry.set(db, store);
}

export function blobStoreFor(db: LibraryDB): BlobStore {
  let s = registry.get(db);
  if (!s) {
    s = new IdbBlobStore(db);
    registry.set(db, s);
  }
  return s;
}

/** 以前の保存先（IndexedDB）にあるファイル実体を新しい保存先へ移す。1件ずつ処理し、途中で止まっても再開できる。 */
export async function migrateBlobs(db: LibraryDB, to: BlobStore): Promise<number> {
  const ids = (await db.blobs.toCollection().primaryKeys()) as string[];
  let moved = 0;
  for (const id of ids) {
    const rec = await db.blobs.get(id);
    if (!rec) continue;
    if (!(await to.has(id))) await to.put(id, rec.data, rec.type);
    // 書き込めたことを確認してから元を消す
    if (await to.has(id)) {
      await db.blobs.delete(id);
      moved++;
    }
  }
  return moved;
}
