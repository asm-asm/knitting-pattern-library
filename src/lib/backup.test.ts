import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryDB } from "../db/db";
import {
  addAnnotation,
  createCategory,
  createCounter,
  createPattern,
  getBlob,
  saveViewState,
  stepCounter,
  UserFacingError,
} from "../db/repo";
import { BACKUP_FORMAT, createBackup, parseBackup, restoreBackup, wipeAllData } from "./backup";
import { newId } from "./id";

const enc = new TextEncoder();
const pdf = (body: string) => enc.encode(`%PDF-1.7\n${body}`).buffer as ArrayBuffer;

let db: LibraryDB;
let patternId: string;
let fileId: string;

beforeEach(async () => {
  db = new LibraryDB("test-" + newId());
  await db.open();
  const cat = await createCategory("セーター", db);
  patternId = await createPattern(
    { title: "ケーブルセーター", status: "in_progress", favorite: true, categoryIds: [cat], tags: ["冬"], notes: "メモ", purchaseUrl: "https://example.com/p" },
    [
      { name: "en.pdf", kind: "original", mimeType: "application/pdf", data: pdf("EN") },
      { name: "en.pdf", kind: "translation", mimeType: "application/pdf", data: pdf("JA") }, // 同名ファイル
    ],
    { type: "image/png", data: new Uint8Array([1, 2, 3]).buffer },
    db,
  );
  fileId = (await db.files.where("patternId").equals(patternId).first())!.id;
  const c = await createCounter(patternId, "身頃", 100, db);
  await stepCounter(c, 12, db);
  await saveViewState(fileId, { page: 3, zoom: 1.5, scrollXRatio: 0, scrollYRatio: 0.4 }, db);
  await addAnnotation({ type: "note", fileId, page: 3, x: 0.2, y: 0.3, text: "ここで減目" }, db);
});
afterEach(async () => {
  await db.delete();
});

async function snapshot(d: LibraryDB) {
  const files = await d.files.toArray();
  return {
    patterns: (await d.patterns.toArray()).map(({ title, status, favorite, tags, notes, purchaseUrl }) => ({ title, status, favorite, tags, notes, purchaseUrl })),
    files: await Promise.all(
      files.map(async (f) => ({ name: f.name, kind: f.kind, page: f.viewState?.page, body: await (await getBlob(f.blobId, d))!.text() })),
    ),
    counters: (await d.counters.toArray()).map((c) => [c.name, c.value, c.target]),
    notes: (await d.annotations.toArray()).map((a) => (a.type === "note" ? a.text : "")),
    categories: (await d.categories.toArray()).map((c) => c.name),
  };
}

describe("完全バックアップ（ZIP）", () => {
  it("書き出し → 全削除 → 復元で同じ状態に戻る", async () => {
    const before = await snapshot(db);
    const blob = await createBackup({ includeFiles: true }, db);
    await wipeAllData(db);
    expect(await db.patterns.count()).toBe(0);

    const parsed = await parseBackup(blob);
    expect(parsed.manifest.includesFiles).toBe(true);
    const r = await restoreBackup(parsed, "replace", db);
    expect(r).toEqual({ patterns: 1, skipped: 0, files: 2, missingFiles: 0 });
    expect(await snapshot(db)).toEqual(before);
    expect((await db.patterns.get(patternId))!.coverBlobId).toBeDefined();
  });

  it("別の端末（空のDB）へ復元できる", async () => {
    const blob = await createBackup({ includeFiles: true }, db);
    const other = new LibraryDB("test-" + newId());
    await other.open();
    try {
      await restoreBackup(await parseBackup(blob), "merge", other);
      expect(await snapshot(other)).toEqual(await snapshot(db));
    } finally {
      await other.delete();
    }
  });

  it("追加モードで同じバックアップを2回復元しても重複しない", async () => {
    const parsed = await parseBackup(await createBackup({ includeFiles: true }, db));
    const r = await restoreBackup(parsed, "merge", db);
    expect(r).toMatchObject({ patterns: 0, skipped: 1 });
    expect(await db.patterns.count()).toBe(1);
    expect(await db.files.count()).toBe(2);
    expect(await db.categories.count()).toBe(1);
  });

  it("同名カテゴリはまとめ、ID が衝突したデータは新しい ID で取り込む", async () => {
    const parsed = await parseBackup(await createBackup({ includeFiles: true }, db));
    // 作品 ID だけ変えて「別の作品」として取り込ませる（ファイル等の ID は衝突する）
    const newPatternId = newId();
    parsed.data.patterns[0].id = newPatternId;
    parsed.data.files.forEach((f) => (f.patternId = newPatternId));
    parsed.data.counters.forEach((c) => (c.patternId = newPatternId));
    parsed.data.categories[0].id = "other-id";
    parsed.data.patterns[0].categoryIds = ["other-id"];

    const r = await restoreBackup(parsed, "merge", db);
    expect(r).toMatchObject({ patterns: 1, files: 2 });
    expect(await db.patterns.count()).toBe(2);
    expect(await db.files.count()).toBe(4);
    expect(await db.blobs.count()).toBe(6);
    expect(await db.annotations.count()).toBe(2);
    expect(await db.categories.count()).toBe(1);
    const restored = (await db.patterns.get(newPatternId))!;
    expect(restored.categoryIds).toEqual((await db.patterns.get(patternId))!.categoryIds);
    // 元の作品のファイルは変わらない
    const orig = await db.files.where("patternId").equals(patternId).toArray();
    expect(orig).toHaveLength(2);
  });
});

describe("データのみ（JSON）", () => {
  it("PDF本体は含まれず、復元時にファイルは取り込まれない", async () => {
    const blob = await createBackup({ includeFiles: false }, db);
    const parsed = await parseBackup(blob);
    expect(parsed.manifest.includesFiles).toBe(false);
    expect(parsed.blobs.size).toBe(0);
    await wipeAllData(db);
    const r = await restoreBackup(parsed, "replace", db);
    expect(r).toEqual({ patterns: 1, skipped: 0, files: 0, missingFiles: 2 });
    expect((await db.counters.toArray())[0].value).toBe(12);
    expect((await db.patterns.toArray())[0].coverBlobId).toBeUndefined();
    expect(await db.annotations.count()).toBe(0);
  });
});

describe("不正なファイル", () => {
  it("バックアップ以外のファイルは拒否する", async () => {
    await expect(parseBackup(new Blob(["hello"]))).rejects.toBeInstanceOf(UserFacingError);
    await expect(parseBackup(new Blob([JSON.stringify({ a: 1 })]))).rejects.toBeInstanceOf(UserFacingError);
    await expect(parseBackup(new Blob([new Uint8Array([0x50, 0x4b, 0, 0])]))).rejects.toThrow(/壊れている/);
  });

  it("新しいバージョンの形式は拒否する", async () => {
    const json = JSON.stringify({ manifest: { format: BACKUP_FORMAT, version: 999 }, data: {} });
    await expect(parseBackup(new Blob([json]))).rejects.toThrow(/新しいバージョン/);
  });

  it("壊れたレコードは読み飛ばし、危険な URL は取り込まない", async () => {
    const json = JSON.stringify({
      manifest: { format: BACKUP_FORMAT, version: 1 },
      data: {
        patterns: [{ id: "x", title: "OK", purchaseUrl: "javascript:alert(1)", status: "???" }, { title: "IDなし" }, null],
        counters: [{ id: "c", patternId: "x", name: "a", value: -5 }],
      },
    });
    const parsed = await parseBackup(new Blob([json]));
    expect(parsed.invalid).toBe(2);
    expect(parsed.data.patterns[0]).toMatchObject({ title: "OK", purchaseUrl: undefined, status: "want" });
    expect(parsed.data.counters[0].value).toBe(0);
  });
});
