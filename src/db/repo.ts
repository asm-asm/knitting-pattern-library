// データ操作の窓口。UI はここを通して保存・削除を行う。
import { db as defaultDb, type LibraryDB } from "./db";
import type { Annotation, Category, FileKind, Pattern, PatternFile, PatternStatus, ViewState } from "./types";
import { newId } from "../lib/id";
import { blobStoreFor } from "../storage/blobStore";

/** ファイル実体を先に保存し、記録の保存に失敗したら実体を片付ける */
async function withBlobs<T>(db: LibraryDB, blobs: { id: string; type: string; data: ArrayBuffer }[], save: () => Promise<T>): Promise<T> {
  const store = blobStoreFor(db);
  const written: string[] = [];
  try {
    for (const b of blobs) {
      await store.put(b.id, b.data, b.type);
      written.push(b.id);
    }
    return await save();
  } catch (e) {
    await store.delete(written).catch(() => undefined);
    throw e;
  }
}

/** 記録の削除が確定してから、ファイル実体を削除する */
async function deleteBlobsAfter(db: LibraryDB, ids: (string | undefined)[]) {
  const list = ids.filter((x): x is string => !!x);
  if (list.length) await blobStoreFor(db).delete(list).catch((e) => console.warn("blob delete failed", e));
}

/** 利用者にそのまま表示してよい日本語メッセージを持つエラー */
export class UserFacingError extends Error {}

export type PatternInput = Omit<Pattern, "id" | "createdAt" | "updatedAt" | "lastOpenedAt" | "coverBlobId">;

export interface NewFileInput {
  name: string;
  kind: FileKind;
  mimeType: string;
  data: ArrayBuffer;
  pageCount?: number;
}

export interface ImageInput {
  type: string;
  data: ArrayBuffer;
}

export const ACCEPTED_FILE_TYPES = "application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif";

export function isPdfData(data: ArrayBuffer): boolean {
  // PDF ヘッダ "%PDF-" は先頭 1024 バイト以内にあればよい（仕様上の許容範囲）
  const head = new Uint8Array(data, 0, Math.min(1024, data.byteLength));
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
  outer: for (let i = 0; i <= head.length - sig.length; i++) {
    for (let j = 0; j < sig.length; j++) if (head[i + j] !== sig[j]) continue outer;
    return true;
  }
  return false;
}

export function isPdfFile(f: { name: string; mimeType: string }): boolean {
  return f.mimeType === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
}

function validateFile(f: NewFileInput): NewFileInput {
  if (f.data.byteLength === 0) {
    throw new UserFacingError(`「${f.name}」は空のファイルです。別のファイルを選んでください。`);
  }
  if (isPdfFile(f)) {
    if (!isPdfData(f.data)) {
      throw new UserFacingError(`「${f.name}」はPDFとして読み込めません。ファイルが壊れていないか確認してください。`);
    }
    return { ...f, mimeType: "application/pdf" };
  }
  if (f.mimeType.startsWith("image/")) return f;
  throw new UserFacingError(`「${f.name}」は登録できない形式です。PDFまたは画像（PNG・JPEG）を選んでください。`);
}

/** http / https のみ許可する（javascript: などを開かないため） */
export function normalizeUrl(input: string | undefined): string | undefined {
  const s = input?.trim();
  if (!s) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UserFacingError("購入先URLの形式が正しくありません。「https://」から始まるURLを入力してください。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UserFacingError("購入先URLには http または https のURLを入力してください。");
  }
  return url.toString();
}

export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const v = t.trim().replace(/^#/, "");
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function cleanPatternInput<T extends Partial<PatternInput>>(input: T): T {
  const out: Partial<PatternInput> = { ...input };
  if ("title" in input) {
    const title = input.title?.trim();
    if (!title) throw new UserFacingError("作品タイトルを入力してください。");
    out.title = title;
  }
  if ("purchaseUrl" in input) out.purchaseUrl = normalizeUrl(input.purchaseUrl);
  if (input.tags) out.tags = normalizeTags(input.tags);
  if ("price" in input && input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) {
    throw new UserFacingError("購入価格は0以上の数値で入力してください。");
  }
  return out as T;
}

function buildFileRecords(patternId: string, files: NewFileInput[], now: number) {
  return files.map((raw) => {
    const f = validateFile(raw);
    const blobId = newId();
    const file: PatternFile = {
      id: newId(),
      patternId,
      name: f.name,
      kind: f.kind,
      mimeType: f.mimeType,
      size: f.data.byteLength,
      createdAt: now,
      blobId,
      pageCount: f.pageCount,
    };
    return { file, blob: { id: blobId, type: f.mimeType, data: f.data } };
  });
}

export async function createPattern(
  input: PatternInput,
  files: NewFileInput[] = [],
  cover?: ImageInput,
  db: LibraryDB = defaultDb,
): Promise<string> {
  const data = cleanPatternInput(input);
  const now = Date.now();
  const id = newId();
  const records = buildFileRecords(id, files, now);
  const coverBlob = cover ? { id: newId(), type: cover.type, data: cover.data } : undefined;
  const pattern: Pattern = { ...data, id, createdAt: now, updatedAt: now, coverBlobId: coverBlob?.id };

  const blobs = [...records.map((r) => r.blob), ...(coverBlob ? [coverBlob] : [])];
  await withBlobs(db, blobs, () =>
    db.transaction("rw", [db.patterns, db.files], async () => {
      await db.patterns.add(pattern);
      await db.files.bulkAdd(records.map((r) => r.file));
    }),
  );
  return id;
}

export async function updatePattern(id: string, patch: Partial<PatternInput>, db: LibraryDB = defaultDb) {
  const data = cleanPatternInput(patch);
  const n = await db.patterns.update(id, { ...data, updatedAt: Date.now() });
  if (n === 0) throw new UserFacingError("作品が見つかりません。すでに削除された可能性があります。");
}

export async function setStatus(id: string, status: PatternStatus, db: LibraryDB = defaultDb) {
  await updatePattern(id, { status }, db);
}

export async function toggleFavorite(id: string, db: LibraryDB = defaultDb) {
  const p = await db.patterns.get(id);
  if (!p) return;
  await db.patterns.update(id, { favorite: !p.favorite, updatedAt: Date.now() });
}

export async function markPatternOpened(id: string, db: LibraryDB = defaultDb) {
  await db.patterns.update(id, { lastOpenedAt: Date.now() });
}

/** 表紙画像を差し替える。null で削除。古い画像の実体も削除する。 */
export async function setPatternCover(id: string, cover: ImageInput | null, db: LibraryDB = defaultDb) {
  const coverBlobId = cover ? newId() : undefined;
  const old = await withBlobs(db, cover && coverBlobId ? [{ id: coverBlobId, ...cover }] : [], () =>
    db.transaction("rw", db.patterns, async () => {
      const p = await db.patterns.get(id);
      if (!p) throw new UserFacingError("作品が見つかりません。");
      await db.patterns.update(id, { coverBlobId, updatedAt: Date.now() });
      return p.coverBlobId;
    }),
  );
  await deleteBlobsAfter(db, [old]);
}

export interface DeletionSummary {
  files: number;
  counters: number;
  annotations: number;
}

export async function getPatternDeletionSummary(id: string, db: LibraryDB = defaultDb): Promise<DeletionSummary> {
  const files = await db.files.where("patternId").equals(id).toArray();
  const counters = await db.counters.where("patternId").equals(id).count();
  const annotations = files.length
    ? await db.annotations.where("fileId").anyOf(files.map((f) => f.id)).count()
    : 0;
  return { files: files.length, counters, annotations };
}

/** 作品と、その作品に属するファイル実体・カウンター・注釈をまとめて削除する。他の作品のデータには触れない。 */
export async function deletePattern(id: string, db: LibraryDB = defaultDb) {
  const blobIds = await db.transaction("rw", [db.patterns, db.files, db.counters, db.annotations], async () => {
    const p = await db.patterns.get(id);
    if (!p) return [];
    const files = await db.files.where("patternId").equals(id).toArray();
    const fileIds = files.map((f) => f.id);
    if (fileIds.length) await db.annotations.where("fileId").anyOf(fileIds).delete();
    await db.files.bulkDelete(fileIds);
    await db.counters.where("patternId").equals(id).delete();
    await db.patterns.delete(id);
    return [...files.map((f) => f.blobId), p.coverBlobId];
  });
  await deleteBlobsAfter(db, blobIds);
}

export async function addFilesToPattern(patternId: string, files: NewFileInput[], db: LibraryDB = defaultDb) {
  const now = Date.now();
  const records = buildFileRecords(patternId, files, now);
  await withBlobs(
    db,
    records.map((r) => r.blob),
    () =>
      db.transaction("rw", [db.patterns, db.files], async () => {
        if (!(await db.patterns.get(patternId))) throw new UserFacingError("作品が見つかりません。");
        await db.files.bulkAdd(records.map((r) => r.file));
        await db.patterns.update(patternId, { updatedAt: now });
      }),
  );
  return records.map((r) => r.file.id);
}

export async function updateFile(
  fileId: string,
  patch: Partial<Pick<PatternFile, "name" | "kind">>,
  db: LibraryDB = defaultDb,
) {
  const clean = { ...patch };
  if ("name" in patch) {
    const name = patch.name?.trim();
    if (!name) throw new UserFacingError("ファイル名を入力してください。");
    clean.name = name;
  }
  await db.files.update(fileId, clean);
}

export async function getFileDeletionSummary(fileId: string, db: LibraryDB = defaultDb) {
  return { annotations: await db.annotations.where("fileId").equals(fileId).count() };
}

/** ファイル1件と、その実体・注釈を削除する。 */
export async function deleteFile(fileId: string, db: LibraryDB = defaultDb) {
  const blobId = await db.transaction("rw", [db.patterns, db.files, db.annotations], async () => {
    const f = await db.files.get(fileId);
    if (!f) return undefined;
    await db.annotations.where("fileId").equals(fileId).delete();
    await db.files.delete(fileId);
    await db.patterns.update(f.patternId, { updatedAt: Date.now() });
    return f.blobId;
  });
  await deleteBlobsAfter(db, [blobId]);
}

export async function saveViewState(fileId: string, viewState: ViewState, db: LibraryDB = defaultDb) {
  await db.files.update(fileId, { viewState, lastOpenedAt: Date.now() });
}

export async function getBlob(blobId: string, db: LibraryDB = defaultDb): Promise<Blob | undefined> {
  return blobStoreFor(db).get(blobId);
}

// ---- カテゴリ ----

export async function createCategory(name: string, db: LibraryDB = defaultDb): Promise<string> {
  const n = name.trim();
  if (!n) throw new UserFacingError("カテゴリ名を入力してください。");
  const all = await db.categories.toArray();
  if (all.some((c) => c.name === n)) throw new UserFacingError(`「${n}」はすでに登録されています。`);
  const id = newId();
  const order = all.reduce((m, c) => Math.max(m, c.order), -1) + 1;
  await db.categories.add({ id, name: n, order, createdAt: Date.now() });
  return id;
}

export async function renameCategory(id: string, name: string, db: LibraryDB = defaultDb) {
  const n = name.trim();
  if (!n) throw new UserFacingError("カテゴリ名を入力してください。");
  const all = await db.categories.toArray();
  if (all.some((c) => c.name === n && c.id !== id)) throw new UserFacingError(`「${n}」はすでに登録されています。`);
  await db.categories.update(id, { name: n });
}

export async function moveCategory(id: string, direction: -1 | 1, db: LibraryDB = defaultDb) {
  await db.transaction("rw", db.categories, async () => {
    const list = await db.categories.orderBy("order").toArray();
    const i = list.findIndex((c) => c.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await db.categories.bulkPut(list.map((c, idx): Category => ({ ...c, order: idx })));
  });
}

/** カテゴリを削除し、各作品からそのカテゴリの割り当てだけを外す（作品自体は削除しない）。 */
export async function deleteCategory(id: string, db: LibraryDB = defaultDb) {
  await db.transaction("rw", [db.categories, db.patterns], async () => {
    await db.patterns
      .where("categoryIds")
      .equals(id)
      .modify((p) => {
        p.categoryIds = p.categoryIds.filter((c) => c !== id);
      });
    await db.categories.delete(id);
  });
}

export async function countPatternsInCategory(id: string, db: LibraryDB = defaultDb) {
  return db.patterns.where("categoryIds").equals(id).count();
}

export const DEFAULT_CATEGORIES = ["セーター", "カーディガン", "ベスト", "帽子", "ショール", "靴下", "小物"];

/** 初回起動時のみ基本カテゴリを用意する */
export async function ensureDefaultCategories(db: LibraryDB = defaultDb) {
  if ((await db.categories.count()) > 0) return;
  const key = "kpl.defaultCategoriesSeeded";
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    /* localStorage が使えない環境では毎回カテゴリ0件判定のみで判断 */
  }
  const now = Date.now();
  await db.categories.bulkAdd(DEFAULT_CATEGORIES.map((name, order) => ({ id: newId(), name, order, createdAt: now })));
}

// ---- 作品メモ ----

export async function updatePatternNotes(id: string, notes: string, db: LibraryDB = defaultDb) {
  await db.patterns.update(id, { notes: notes.trim() ? notes : undefined, updatedAt: Date.now() });
}

// ---- 段数カウンター（作品単位） ----

function cleanTarget(target: number | undefined) {
  if (target === undefined) return undefined;
  if (!Number.isInteger(target) || target <= 0) throw new UserFacingError("目標段数は1以上の整数で入力してください。");
  return target;
}

export async function createCounter(patternId: string, name: string, target?: number, db: LibraryDB = defaultDb) {
  const n = name.trim() || "カウンター";
  const t = cleanTarget(target);
  const id = newId();
  await db.transaction("rw", db.counters, async () => {
    const list = await db.counters.where("patternId").equals(patternId).toArray();
    const now = Date.now();
    await db.counters.add({
      id,
      patternId,
      name: n,
      value: 0,
      target: t,
      order: list.reduce((m, c) => Math.max(m, c.order), -1) + 1,
      createdAt: now,
      updatedAt: now,
    });
  });
  return id;
}

/** 加算・減算。連打されても取りこぼさないよう DB 上で原子的に更新する。0 未満にはしない。 */
export async function stepCounter(id: string, delta: number, db: LibraryDB = defaultDb) {
  await db.counters
    .where("id")
    .equals(id)
    .modify((c) => {
      c.value = Math.max(0, c.value + delta);
      c.updatedAt = Date.now();
    });
}

export async function resetCounter(id: string, db: LibraryDB = defaultDb) {
  await db.counters.update(id, { value: 0, updatedAt: Date.now() });
}

export async function updateCounter(
  id: string,
  patch: { name?: string; target?: number | null; value?: number },
  db: LibraryDB = defaultDb,
) {
  const changes: Partial<{ name: string; target: number | undefined; value: number; updatedAt: number }> = {
    updatedAt: Date.now(),
  };
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new UserFacingError("カウンター名を入力してください。");
    changes.name = n;
  }
  if (patch.target !== undefined) changes.target = patch.target === null ? undefined : cleanTarget(patch.target);
  if (patch.value !== undefined) {
    if (!Number.isInteger(patch.value) || patch.value < 0) throw new UserFacingError("段数は0以上の整数で入力してください。");
    changes.value = patch.value;
  }
  await db.counters.update(id, changes);
}

export async function deleteCounter(id: string, db: LibraryDB = defaultDb) {
  await db.counters.delete(id);
}

// ---- 注釈（ファイル単位・ページ単位） ----

type NewAnnotation = DistributiveOmit<Annotation, "id" | "createdAt" | "updatedAt">;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export async function addAnnotation(a: NewAnnotation, db: LibraryDB = defaultDb): Promise<string> {
  const now = Date.now();
  const id = newId();
  await db.annotations.add({ ...a, id, createdAt: now, updatedAt: now } as Annotation);
  return id;
}

export async function updateNoteText(id: string, text: string, db: LibraryDB = defaultDb) {
  await db.annotations.update(id, { text, updatedAt: Date.now() } as Partial<Annotation>);
}

export async function deleteAnnotation(id: string, db: LibraryDB = defaultDb) {
  await db.annotations.delete(id);
}

export async function deletePageAnnotations(fileId: string, page: number, db: LibraryDB = defaultDb) {
  await db.annotations.where("[fileId+page]").equals([fileId, page]).delete();
}

/** 「元に戻す」で削除した注釈を復元する */
export async function restoreAnnotation(a: Annotation, db: LibraryDB = defaultDb) {
  await db.annotations.put(a);
}
