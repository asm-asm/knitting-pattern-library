// バックアップ（書き出し）と復元。すべて端末内で処理し、外部へは送信しない。
//
// 完全バックアップ（.zip）
//   manifest.json  … 形式・作成日時・件数
//   data.json      … 作品・ファイル情報・カテゴリ・カウンター・注釈
//   blobs/<id>     … PDF・画像・表紙の実体（ファイル名ではなく ID で保存するため名前の重複は起きない）
// データのみ（.json）
//   { manifest, data } … PDF本体と表紙画像は含まない
import { Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8, unzipSync } from "fflate";
import { db as defaultDb, type LibraryDB } from "../db/db";
import { UserFacingError, normalizeUrl } from "../db/repo";
import {
  FILE_KIND_ORDER,
  STATUS_ORDER,
  type Annotation,
  type Category,
  type Counter,
  type Pattern,
  type PatternFile,
  type StoredBlob,
} from "../db/types";
import { newId } from "./id";

export const BACKUP_FORMAT = "knitting-pattern-library-backup";
export const BACKUP_VERSION = 1;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  includesFiles: boolean;
  counts: { patterns: number; files: number; counters: number; annotations: number; categories: number };
}

export interface BackupData {
  patterns: Pattern[];
  files: PatternFile[];
  categories: Category[];
  counters: Counter[];
  annotations: Annotation[];
}

export interface ParsedBackup {
  manifest: BackupManifest;
  data: BackupData;
  blobs: Map<string, { type: string; data: Uint8Array }>;
  /** 形式が不正で読み飛ばした件数 */
  invalid: number;
}

async function readAll(db: LibraryDB): Promise<BackupData> {
  return db.transaction("r", [db.patterns, db.files, db.categories, db.counters, db.annotations], async () => ({
    patterns: await db.patterns.toArray(),
    files: await db.files.toArray(),
    categories: await db.categories.toArray(),
    counters: await db.counters.toArray(),
    annotations: await db.annotations.toArray(),
  }));
}

function manifestFor(data: BackupData, includesFiles: boolean): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    includesFiles,
    counts: {
      patterns: data.patterns.length,
      files: data.files.length,
      counters: data.counters.length,
      annotations: data.annotations.length,
      categories: data.categories.length,
    },
  };
}

export function backupFileName(includeFiles: boolean, now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `knitting-library-${includeFiles ? "backup" : "data"}-${stamp}.${includeFiles ? "zip" : "json"}`;
}

export async function createBackup(opts: { includeFiles: boolean }, db: LibraryDB = defaultDb): Promise<Blob> {
  const data = await readAll(db);
  if (!opts.includeFiles) {
    const json = JSON.stringify({ manifest: manifestFor(data, false), data });
    return new Blob([json], { type: "application/json" });
  }

  const chunks: Uint8Array[] = [];
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const finished = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
  const zip = new Zip((err, chunk, final) => {
    if (err) return reject(err);
    chunks.push(chunk);
    if (final) resolve();
  });
  const addText = (name: string, text: string) => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(strToU8(text), true);
  };

  // PDF は圧縮済みのことが多いので無圧縮で格納し、処理を軽くする。1件ずつ読み出してメモリ使用を抑える。
  const blobIds = new Set<string>();
  for (const f of data.files) blobIds.add(f.blobId);
  for (const p of data.patterns) if (p.coverBlobId) blobIds.add(p.coverBlobId);
  const blobTypes: Record<string, string> = {};
  for (const id of blobIds) {
    const b = await db.blobs.get(id);
    if (!b) continue;
    blobTypes[id] = b.type;
    const entry = new ZipPassThrough(`blobs/${id}`);
    zip.add(entry);
    entry.push(new Uint8Array(b.data), true);
  }
  addText("manifest.json", JSON.stringify(manifestFor(data, true), null, 2));
  addText("data.json", JSON.stringify({ ...data, blobTypes }));
  zip.end();
  await finished;
  return new Blob(chunks as BlobPart[], { type: "application/zip" });
}

// ---- 読み込みと検証 ----

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optStr = (v: unknown) => (isStr(v) && v.trim() ? v : undefined);
const optNum = (v: unknown) => (isNum(v) ? v : undefined);

function cleanPattern(r: Record<string, unknown>): Pattern | null {
  if (!isStr(r.id) || !isStr(r.title) || !r.title.trim()) return null;
  let purchaseUrl: string | undefined;
  try {
    purchaseUrl = normalizeUrl(optStr(r.purchaseUrl));
  } catch {
    purchaseUrl = undefined; // 不正な URL は取り込まない
  }
  const now = Date.now();
  return {
    id: r.id,
    title: r.title,
    createdAt: optNum(r.createdAt) ?? now,
    updatedAt: optNum(r.updatedAt) ?? now,
    lastOpenedAt: optNum(r.lastOpenedAt),
    status: STATUS_ORDER.includes(r.status as Pattern["status"]) ? (r.status as Pattern["status"]) : "want",
    favorite: r.favorite === true,
    categoryIds: Array.isArray(r.categoryIds) ? r.categoryIds.filter(isStr) : [],
    tags: Array.isArray(r.tags) ? r.tags.filter(isStr) : [],
    coverBlobId: optStr(r.coverBlobId),
    purchaseUrl,
    shopName: optStr(r.shopName),
    designer: optStr(r.designer),
    purchaseDate: optStr(r.purchaseDate),
    price: optNum(r.price),
    currency: optStr(r.currency),
    yarn: optStr(r.yarn),
    needles: optStr(r.needles),
    size: optStr(r.size),
    gauge: optStr(r.gauge),
    difficulty: optStr(r.difficulty),
    notes: optStr(r.notes),
  };
}

function cleanFile(r: Record<string, unknown>): PatternFile | null {
  if (!isStr(r.id) || !isStr(r.patternId) || !isStr(r.blobId) || !isStr(r.name)) return null;
  const vs = r.viewState as Record<string, unknown> | undefined;
  return {
    id: r.id,
    patternId: r.patternId,
    name: r.name,
    kind: FILE_KIND_ORDER.includes(r.kind as PatternFile["kind"]) ? (r.kind as PatternFile["kind"]) : "other",
    mimeType: isStr(r.mimeType) ? r.mimeType : "application/octet-stream",
    size: optNum(r.size) ?? 0,
    createdAt: optNum(r.createdAt) ?? Date.now(),
    blobId: r.blobId,
    pageCount: optNum(r.pageCount),
    lastOpenedAt: optNum(r.lastOpenedAt),
    viewState:
      vs && isNum(vs.page) && isNum(vs.zoom)
        ? { page: vs.page, zoom: vs.zoom, scrollXRatio: optNum(vs.scrollXRatio) ?? 0, scrollYRatio: optNum(vs.scrollYRatio) ?? 0 }
        : undefined,
  };
}

function cleanCategory(r: Record<string, unknown>): Category | null {
  if (!isStr(r.id) || !isStr(r.name) || !r.name.trim()) return null;
  return { id: r.id, name: r.name.trim(), order: optNum(r.order) ?? 0, createdAt: optNum(r.createdAt) ?? Date.now() };
}

function cleanCounter(r: Record<string, unknown>): Counter | null {
  if (!isStr(r.id) || !isStr(r.patternId) || !isStr(r.name)) return null;
  const now = Date.now();
  return {
    id: r.id,
    patternId: r.patternId,
    name: r.name,
    value: Math.max(0, Math.floor(optNum(r.value) ?? 0)),
    target: optNum(r.target),
    order: optNum(r.order) ?? 0,
    createdAt: optNum(r.createdAt) ?? now,
    updatedAt: optNum(r.updatedAt) ?? now,
  };
}

function cleanAnnotation(r: Record<string, unknown>): Annotation | null {
  if (!isStr(r.id) || !isStr(r.fileId) || !isNum(r.page)) return null;
  const now = Date.now();
  const base = { id: r.id, fileId: r.fileId, page: r.page, createdAt: optNum(r.createdAt) ?? now, updatedAt: optNum(r.updatedAt) ?? now };
  if (r.type === "ink" && Array.isArray(r.points) && r.points.every(isNum) && isNum(r.width)) {
    return { ...base, type: "ink", points: r.points as number[], color: isStr(r.color) ? r.color : "#f5d000", width: r.width, opacity: optNum(r.opacity) ?? 1 };
  }
  if (r.type === "note" && isNum(r.x) && isNum(r.y) && isStr(r.text)) {
    return { ...base, type: "note", x: r.x, y: r.y, text: r.text };
  }
  return null;
}

function cleanList<T>(v: unknown, fn: (r: Record<string, unknown>) => T | null, counter: { invalid: number }): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const r of v) {
    const c = r && typeof r === "object" ? fn(r as Record<string, unknown>) : null;
    if (c) out.push(c);
    else counter.invalid++;
  }
  return out;
}

const NOT_BACKUP = "このファイルはバックアップとして読み込めません。このアプリで作成したバックアップ（.zip または .json）を選んでください。";

export async function parseBackup(input: Blob): Promise<ParsedBackup> {
  const bytes = new Uint8Array(await input.arrayBuffer());
  let manifestRaw: unknown;
  let dataRaw: Record<string, unknown>;
  const blobs = new Map<string, { type: string; data: Uint8Array }>();

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new UserFacingError("バックアップファイル（ZIP）が壊れているため読み込めません。");
    }
    if (!entries["manifest.json"] || !entries["data.json"]) throw new UserFacingError(NOT_BACKUP);
    try {
      manifestRaw = JSON.parse(strFromU8(entries["manifest.json"]));
      dataRaw = JSON.parse(strFromU8(entries["data.json"]));
    } catch {
      throw new UserFacingError("バックアップの内容が壊れているため読み込めません。");
    }
    const types = (dataRaw.blobTypes ?? {}) as Record<string, unknown>;
    for (const [name, data] of Object.entries(entries)) {
      const m = /^blobs\/([^/]+)$/.exec(name);
      if (m) blobs.set(m[1], { type: isStr(types[m[1]]) ? (types[m[1]] as string) : "application/octet-stream", data });
    }
  } else {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      manifestRaw = parsed?.manifest;
      dataRaw = parsed?.data;
    } catch {
      throw new UserFacingError(NOT_BACKUP);
    }
  }

  const m = manifestRaw as Partial<BackupManifest> | undefined;
  if (!m || m.format !== BACKUP_FORMAT || !dataRaw || typeof dataRaw !== "object") throw new UserFacingError(NOT_BACKUP);
  if (!isNum(m.version) || m.version > BACKUP_VERSION) {
    throw new UserFacingError("新しいバージョンのアプリで作成されたバックアップです。アプリを最新版に更新してから復元してください。");
  }

  const counter = { invalid: 0 };
  const data: BackupData = {
    patterns: cleanList(dataRaw.patterns, cleanPattern, counter),
    files: cleanList(dataRaw.files, cleanFile, counter),
    categories: cleanList(dataRaw.categories, cleanCategory, counter),
    counters: cleanList(dataRaw.counters, cleanCounter, counter),
    annotations: cleanList(dataRaw.annotations, cleanAnnotation, counter),
  };
  return { manifest: m as BackupManifest, data, blobs, invalid: counter.invalid };
}

// ---- 復元 ----

export type RestoreMode = "merge" | "replace";

export interface RestoreResult {
  patterns: number;
  /** すでに同じ作品があったため取り込まなかった件数（追加モード） */
  skipped: number;
  files: number;
  /** バックアップに本体が含まれていなかったファイル数 */
  missingFiles: number;
}

/**
 * merge: 端末にない作品だけを追加する（同じバックアップを2回復元しても重複しない）。
 * replace: 端末内のデータをすべて削除してから復元する。
 * ID が他のデータと衝突した場合は新しい ID を振り直し、参照も付け替える。
 */
export async function restoreBackup(parsed: ParsedBackup, mode: RestoreMode, db: LibraryDB = defaultDb): Promise<RestoreResult> {
  const { data, blobs } = parsed;
  const result: RestoreResult = { patterns: 0, skipped: 0, files: 0, missingFiles: 0 };

  await db.transaction("rw", [db.patterns, db.files, db.blobs, db.categories, db.counters, db.annotations], async () => {
    if (mode === "replace") {
      await Promise.all([db.patterns.clear(), db.files.clear(), db.blobs.clear(), db.categories.clear(), db.counters.clear(), db.annotations.clear()]);
    }

    const putBlob = async (blobId: string): Promise<string | undefined> => {
      const b = blobs.get(blobId);
      if (!b) return undefined;
      const id = (await db.blobs.get(blobId)) ? newId() : blobId;
      // zip 内の領域を参照している可能性があるのでコピーして保存する
      const record: StoredBlob = { id, type: b.type, data: b.data.slice().buffer as ArrayBuffer };
      await db.blobs.add(record);
      return id;
    };
    const freeId = async (table: { get: (id: string) => Promise<unknown> }, id: string) => ((await table.get(id)) ? newId() : id);

    // カテゴリ：同じ ID または同じ名前があればそれを使う
    const localCats = await db.categories.toArray();
    let nextOrder = localCats.reduce((m, c) => Math.max(m, c.order), -1) + 1;
    const catMap = new Map<string, string>();
    for (const c of [...data.categories].sort((a, b) => a.order - b.order)) {
      const same = localCats.find((l) => l.id === c.id) ?? localCats.find((l) => l.name === c.name);
      if (same) {
        catMap.set(c.id, same.id);
        continue;
      }
      const rec = { ...c, order: nextOrder++ };
      await db.categories.add(rec);
      localCats.push(rec);
      catMap.set(c.id, c.id);
    }

    for (const p of data.patterns) {
      if (await db.patterns.get(p.id)) {
        result.skipped++;
        continue;
      }
      const coverBlobId = p.coverBlobId ? await putBlob(p.coverBlobId) : undefined;
      const fileIdMap = new Map<string, string>();
      for (const f of data.files.filter((x) => x.patternId === p.id)) {
        const blobId = await putBlob(f.blobId);
        if (!blobId) {
          result.missingFiles++;
          continue;
        }
        const id = await freeId(db.files, f.id);
        fileIdMap.set(f.id, id);
        await db.files.add({ ...f, id, blobId });
        result.files++;
      }
      for (const c of data.counters.filter((x) => x.patternId === p.id)) {
        await db.counters.add({ ...c, id: await freeId(db.counters, c.id) });
      }
      for (const a of data.annotations) {
        const fileId = fileIdMap.get(a.fileId);
        if (fileId) await db.annotations.add({ ...a, id: await freeId(db.annotations, a.id), fileId });
      }
      await db.patterns.add({
        ...p,
        coverBlobId,
        categoryIds: [...new Set(p.categoryIds.map((id) => catMap.get(id)).filter((x): x is string => !!x))],
      });
      result.patterns++;
    }
  });
  return result;
}

/** 端末内のすべてのデータを削除する */
export async function wipeAllData(db: LibraryDB = defaultDb) {
  await db.transaction("rw", [db.patterns, db.files, db.blobs, db.categories, db.counters, db.annotations], async () => {
    await Promise.all([db.patterns.clear(), db.files.clear(), db.blobs.clear(), db.categories.clear(), db.counters.clear(), db.annotations.clear()]);
  });
}
