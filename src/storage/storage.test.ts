import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryDB } from "../db/db";
import { createCounter, createPattern, deletePattern, getBlob, stepCounter, type NewFileInput } from "../db/repo";
import { createBackup, parseBackup, restoreBackup, wipeAllData } from "../lib/backup";
import { newId } from "../lib/id";
import { FallbackBlobStore, IdbBlobStore, MemoryBlobStore, migrateBlobs, registerBlobStore, sniffType, type BlobStore } from "./blobStore";
import { MemorySnapshotIO, readLatestSnapshot, recoverFromSnapshot, SnapshotWriter } from "./snapshot";

const enc = new TextEncoder();
const pdf = (name: string, body = "x"): NewFileInput => ({
  name,
  kind: "original",
  mimeType: "application/pdf",
  data: enc.encode(`%PDF-1.7\n${body}`).buffer as ArrayBuffer,
});
const png = { type: "image/png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]).buffer as ArrayBuffer };
const base = (title: string) => ({ title, status: "want" as const, favorite: false, categoryIds: [], tags: [] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: LibraryDB;
let native: MemoryBlobStore;
beforeEach(async () => {
  db = new LibraryDB("test-" + newId());
  await db.open();
  native = new MemoryBlobStore();
  registerBlobStore(db, new FallbackBlobStore(native, new IdbBlobStore(db)));
});
afterEach(async () => {
  await db.delete();
});

describe("ファイル実体の保存先（iOS アプリ版）", () => {
  it("PDF と表紙はアプリ専用フォルダに保存され、IndexedDB には入らない", async () => {
    const id = await createPattern(base("A"), [pdf("a.pdf", "A")], png, db);
    expect(native.files.size).toBe(2);
    expect(await db.blobs.count()).toBe(0);
    const f = (await db.files.where("patternId").equals(id).first())!;
    expect(await (await getBlob(f.blobId, db))!.text()).toBe("%PDF-1.7\nA");
    expect((await getBlob((await db.patterns.get(id))!.coverBlobId!, db))!.type).toBe("image/png");
  });

  it("作品を削除すると、その作品の実体だけが消える", async () => {
    const a = await createPattern(base("A"), [pdf("a.pdf")], png, db);
    await createPattern(base("B"), [pdf("b.pdf")], undefined, db);
    await deletePattern(a, db);
    expect(native.files.size).toBe(1);
  });

  it("保存の途中で失敗したら、書き込んだ実体を片付けて記録も残さない", async () => {
    let count = 0;
    const failing: BlobStore = {
      ...native,
      put: async (id, data) => {
        if (++count === 2) throw new Error("disk full");
        await native.put(id, data);
      },
      get: (id) => native.get(id),
      has: (id) => native.has(id),
      delete: (ids) => native.delete(ids),
      clear: () => native.clear(),
    };
    registerBlobStore(db, failing);
    await expect(createPattern(base("A"), [pdf("1.pdf"), pdf("2.pdf")], undefined, db)).rejects.toThrow("disk full");
    expect(native.files.size).toBe(0);
    expect(await db.patterns.count()).toBe(0);
  });

  it("以前の保存先（IndexedDB）の実体を移行でき、移行前でも読める", async () => {
    // 以前のバージョンで保存されたデータを再現
    registerBlobStore(db, new IdbBlobStore(db));
    const id = await createPattern(base("旧データ"), [pdf("old.pdf", "OLD")], png, db);
    const f = (await db.files.where("patternId").equals(id).first())!;
    expect(await db.blobs.count()).toBe(2);

    registerBlobStore(db, new FallbackBlobStore(native, new IdbBlobStore(db)));
    expect(await (await getBlob(f.blobId, db))!.text()).toBe("%PDF-1.7\nOLD"); // 移行前

    expect(await migrateBlobs(db, native)).toBe(2);
    expect(await db.blobs.count()).toBe(0);
    expect(await (await getBlob(f.blobId, db))!.text()).toBe("%PDF-1.7\nOLD"); // 移行後
    expect(await migrateBlobs(db, native)).toBe(0); // 2回目は何もしない
  });

  it("バックアップ → 全削除 → 復元が新しい保存先でも動く", async () => {
    await createPattern(base("A"), [pdf("a.pdf", "A")], png, db);
    const blob = await createBackup({ includeFiles: true }, db);
    await wipeAllData(db);
    expect(native.files.size).toBe(0);
    await restoreBackup(await parseBackup(blob), "replace", db);
    expect(native.files.size).toBe(2);
    const f = (await db.files.toArray())[0];
    expect(await (await getBlob(f.blobId, db))!.text()).toBe("%PDF-1.7\nA");
  });

  it("置き換え復元では、復元した実体を消さずに古い実体だけを消す", async () => {
    await createPattern(base("A"), [pdf("a.pdf", "A")], undefined, db);
    const parsed = await parseBackup(await createBackup({ includeFiles: true }, db));
    await restoreBackup(parsed, "replace", db);
    expect(native.files.size).toBe(1);
    const f = (await db.files.toArray())[0];
    expect(await (await getBlob(f.blobId, db))!.text()).toBe("%PDF-1.7\nA");
  });

  it("種類の判定", () => {
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe("image/jpeg");
    expect(sniffType(enc.encode("%PDF-1.4"))).toBe("application/pdf");
  });
});

describe("自動の控え（スナップショット）と復元", () => {
  it("変更すると控えが自動で保存され、A/B に交互に書かれる", async () => {
    const io = new MemorySnapshotIO();
    const w = new SnapshotWriter(db, io, 10);
    await w.start();
    const id = await createPattern(base("セーター"), [], undefined, db);
    await wait(50);
    await w.flush();
    expect(io.slots.a).toContain("セーター");
    const c = await createCounter(id, "身頃", undefined, db);
    await stepCounter(c, 5, db);
    await wait(50);
    await w.flush();
    expect(io.slots.b).toContain("身頃");
    const latest = await readLatestSnapshot(io);
    expect(latest!.seq).toBe(2);
    w.stop();
  });

  it("片方の控えが壊れていても、もう片方から読める", async () => {
    const io = new MemorySnapshotIO();
    const w = new SnapshotWriter(db, io, 10);
    await w.start();
    await createPattern(base("A"), [], undefined, db);
    await w.flush(true);
    io.slots.b = '{"format":"knitting-library-snap'; // 書きかけ
    expect((await readLatestSnapshot(io))!.seq).toBe(1);
    w.stop();
  });

  it("データベースが消えても、控えから作品・カウンター・ファイル情報が自動で戻る", async () => {
    const io = new MemorySnapshotIO();
    const w = new SnapshotWriter(db, io, 10);
    await w.start();
    const id = await createPattern({ ...base("ケーブル"), notes: "2号針" }, [pdf("en.pdf", "EN")], undefined, db);
    const c = await createCounter(id, "身頃", 100, db);
    await stepCounter(c, 12, db);
    await w.flush(true);
    w.stop();

    // iOS に WebView のデータを消された状態を再現（実体はアプリ専用フォルダに残っている）
    const fresh = new LibraryDB("test-" + newId());
    await fresh.open();
    registerBlobStore(fresh, native);
    await fresh.categories.add({ id: "default", name: "セーター", order: 0, createdAt: 0 }); // 起動時の基本カテゴリ
    try {
      expect(await recoverFromSnapshot(fresh, io)).toEqual({ patterns: 1, files: 1 });
      const p = (await fresh.patterns.get(id))!;
      expect(p.notes).toBe("2号針");
      expect((await fresh.counters.toArray())[0].value).toBe(12);
      const f = (await fresh.files.toArray())[0];
      expect(await (await getBlob(f.blobId, fresh))!.text()).toBe("%PDF-1.7\nEN");
      expect(await fresh.categories.get("default")).toBeUndefined();
    } finally {
      await fresh.delete();
    }
  });

  it("データがある場合は復元しない", async () => {
    const io = new MemorySnapshotIO();
    const w = new SnapshotWriter(db, io, 10);
    await w.start();
    await createPattern(base("A"), [], undefined, db);
    await w.flush(true);
    w.stop();
    expect(await recoverFromSnapshot(db, io)).toBeUndefined();
  });

  it("削除した作品・全データ削除は、すぐ控えに反映され、復元で戻ってこない", async () => {
    const io = new MemorySnapshotIO();
    const w = new SnapshotWriter(db, io, 5000); // 通常の保存は遅くしておく
    await w.start();
    const a = await createPattern(base("消す作品"), [], undefined, db);
    await createPattern(base("残す作品"), [], undefined, db);
    await w.flush(true);
    await deletePattern(a, db);
    await wait(150); // 削除は 50ms で反映
    expect(io.slots.b).not.toContain("消す作品");
    expect(io.slots.b).toContain("残す作品");

    await wipeAllData(db);
    await wait(150);
    w.stop();
    expect(await recoverFromSnapshot(db, io)).toBeUndefined();
    expect(await db.patterns.count()).toBe(0);
  });
});
