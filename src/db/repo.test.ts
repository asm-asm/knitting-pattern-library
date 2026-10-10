import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryDB } from "./db";
import {
  UserFacingError,
  addFilesToPattern,
  createCategory,
  createPattern,
  deleteCategory,
  deleteFile,
  deletePattern,
  getBlob,
  getPatternDeletionSummary,
  normalizeUrl,
  saveViewState,
  setPatternCover,
  setStatus,
  updatePattern,
  type NewFileInput,
  type PatternInput,
} from "./repo";
import { newId } from "../lib/id";
import type { Annotation } from "./types";

const enc = new TextEncoder();
const pdf = (name: string, kind: NewFileInput["kind"] = "original", body = "hello"): NewFileInput => ({
  name,
  kind,
  mimeType: "application/pdf",
  data: enc.encode(`%PDF-1.7\n${body}`).buffer as ArrayBuffer,
  pageCount: 3,
});
const base = (title = "テスト作品"): PatternInput => ({
  title,
  status: "want",
  favorite: false,
  categoryIds: [],
  tags: [],
});

let db: LibraryDB;
beforeEach(async () => {
  db = new LibraryDB("test-" + newId());
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe("作品の登録", () => {
  it("英語原本と日本語版を1作品にまとめて登録できる", async () => {
    const id = await createPattern(base(), [pdf("Sweater.pdf"), pdf("セーター_日本語.pdf", "translation", "jp")], undefined, db);
    const files = await db.files.where("patternId").equals(id).toArray();
    expect(files.map((f) => f.kind).sort()).toEqual(["original", "translation"]);
    // 実体は別々に保存され、それぞれ取り出せる
    const texts = await Promise.all(files.map(async (f) => (await getBlob(f.blobId, db))!.text()));
    expect(texts.sort()).toEqual(["%PDF-1.7\nhello", "%PDF-1.7\njp"]);
  });

  it("URLだけ・PDFだけの登録ができる", async () => {
    const a = await createPattern({ ...base("URLのみ"), purchaseUrl: "www.ravelry.com/patterns/x" }, [], undefined, db);
    expect((await db.patterns.get(a))!.purchaseUrl).toBe("https://www.ravelry.com/patterns/x");
    const b = await createPattern(base("PDFのみ"), [pdf("a.pdf")], undefined, db);
    expect(await db.files.where("patternId").equals(b).count()).toBe(1);
  });

  it("タイトル未入力はエラー", async () => {
    await expect(createPattern(base("  "), [], undefined, db)).rejects.toBeInstanceOf(UserFacingError);
  });

  it("PDFではないデータはPDFとして登録できない（破損PDF）", async () => {
    const broken = { ...pdf("broken.pdf"), data: enc.encode("not a pdf").buffer as ArrayBuffer };
    await expect(createPattern(base(), [broken], undefined, db)).rejects.toThrow(/PDFとして読み込めません/);
    expect(await db.patterns.count()).toBe(0);
  });

  it("javascript: URL は拒否する", () => {
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow(UserFacingError);
  });
});

describe("編集", () => {
  it("ステータスを変更しても他の作品情報は失われない", async () => {
    const id = await createPattern(
      { ...base(), designer: "Designer", tags: ["春", "#春", "糸"], notes: "メモ", favorite: true },
      [pdf("a.pdf")],
      undefined,
      db,
    );
    await setStatus(id, "in_progress", db);
    const p = (await db.patterns.get(id))!;
    expect(p.status).toBe("in_progress");
    expect(p.designer).toBe("Designer");
    expect(p.tags).toEqual(["春", "糸"]);
    expect(p.favorite).toBe(true);
    expect(await db.files.where("patternId").equals(id).count()).toBe(1);
  });

  it("既存作品に修正版を追加しても原本は上書きされない", async () => {
    const id = await createPattern(base(), [pdf("orig.pdf")], undefined, db);
    await addFilesToPattern(id, [pdf("orig.pdf", "revised", "v2")], db);
    const files = await db.files.where("patternId").equals(id).toArray();
    expect(files).toHaveLength(2);
    expect(new Set(files.map((f) => f.blobId)).size).toBe(2);
  });

  it("閲覧位置はファイルごとに独立して保存される", async () => {
    const id = await createPattern(base(), [pdf("en.pdf"), pdf("ja.pdf", "translation")], undefined, db);
    const [a, b] = await db.files.where("patternId").equals(id).toArray();
    await saveViewState(a.id, { page: 5, zoom: 1.5, scrollXRatio: 0, scrollYRatio: 0.2 }, db);
    await saveViewState(b.id, { page: 2, zoom: 1, scrollXRatio: 0, scrollYRatio: 0 }, db);
    expect((await db.files.get(a.id))!.viewState!.page).toBe(5);
    expect((await db.files.get(b.id))!.viewState!.page).toBe(2);
  });

  it("表紙を差し替えると古い画像の実体は削除される", async () => {
    const id = await createPattern(base(), [], { type: "image/png", data: new ArrayBuffer(4) }, db);
    const old = (await db.patterns.get(id))!.coverBlobId!;
    await setPatternCover(id, { type: "image/png", data: new ArrayBuffer(8) }, db);
    expect(await db.blobs.get(old)).toBeUndefined();
    await setPatternCover(id, null, db);
    expect((await db.patterns.get(id))!.coverBlobId).toBeUndefined();
    expect(await db.blobs.count()).toBe(0);
  });

  it("存在しない作品の更新はエラー", async () => {
    await expect(updatePattern("nope", { title: "x" }, db)).rejects.toBeInstanceOf(UserFacingError);
  });
});

describe("削除", () => {
  it("作品を削除すると関連データも削除され、他の作品には影響しない", async () => {
    const a = await createPattern(base("A"), [pdf("a.pdf")], { type: "image/png", data: new ArrayBuffer(4) }, db);
    const b = await createPattern(base("B"), [pdf("b.pdf")], undefined, db);
    const fa = (await db.files.where("patternId").equals(a).first())!;
    const now = Date.now();
    await db.counters.add({ id: newId(), patternId: a, name: "身頃", value: 3, order: 0, createdAt: now, updatedAt: now });
    const note: Annotation = { id: newId(), fileId: fa.id, page: 1, type: "note", x: 0.1, y: 0.1, text: "x", createdAt: now, updatedAt: now };
    await db.annotations.add(note);

    expect(await getPatternDeletionSummary(a, db)).toEqual({ files: 1, counters: 1, annotations: 1 });
    await deletePattern(a, db);

    expect(await db.patterns.get(a)).toBeUndefined();
    expect(await db.counters.count()).toBe(0);
    expect(await db.annotations.count()).toBe(0);
    expect(await db.blobs.count()).toBe(1); // B の PDF だけ残る
    const fb = (await db.files.where("patternId").equals(b).first())!;
    expect(await getBlob(fb.blobId, db)).toBeDefined();
  });

  it("ファイルを削除しても同じ作品の別ファイルや他作品のファイルは残る", async () => {
    const a = await createPattern(base("A"), [pdf("en.pdf"), pdf("ja.pdf", "translation")], undefined, db);
    const b = await createPattern(base("B"), [pdf("en.pdf")], undefined, db);
    const [f1, f2] = await db.files.where("patternId").equals(a).toArray();
    await deleteFile(f1.id, db);
    expect(await db.files.get(f2.id)).toBeDefined();
    expect(await getBlob(f2.blobId, db)).toBeDefined();
    expect(await db.files.where("patternId").equals(b).count()).toBe(1);
    expect(await db.blobs.count()).toBe(2);
  });

  it("カテゴリを削除しても作品は残り、割り当てだけ外れる", async () => {
    const c1 = await createCategory("帽子", db);
    const c2 = await createCategory("小物", db);
    await expect(createCategory("帽子", db)).rejects.toBeInstanceOf(UserFacingError);
    const id = await createPattern({ ...base(), categoryIds: [c1, c2] }, [], undefined, db);
    await deleteCategory(c1, db);
    expect((await db.patterns.get(id))!.categoryIds).toEqual([c2]);
  });
});
