import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryDB } from "./db";
import {
  UserFacingError,
  addAnnotation,
  createCounter,
  createPattern,
  deleteAnnotation,
  deleteCounter,
  deletePageAnnotations,
  resetCounter,
  stepCounter,
  updateCounter,
  updateNoteText,
  updatePatternNotes,
} from "./repo";
import { newId } from "../lib/id";

let db: LibraryDB;
let patternId: string;
beforeEach(async () => {
  db = new LibraryDB("test-" + newId());
  await db.open();
  patternId = await createPattern({ title: "作品", status: "in_progress", favorite: false, categoryIds: [], tags: [] }, [], undefined, db);
});
afterEach(async () => {
  await db.delete();
});

describe("段数カウンター", () => {
  it("1作品に複数作成でき、加算・減算・リセットできる", async () => {
    const body = await createCounter(patternId, "身頃", 120, db);
    const sleeve = await createCounter(patternId, "左袖", undefined, db);
    await Promise.all([stepCounter(body, 1, db), stepCounter(body, 1, db), stepCounter(body, 1, db)]);
    await stepCounter(body, -1, db);
    await stepCounter(sleeve, -1, db); // 0 未満にはならない
    const list = await db.counters.where("patternId").equals(patternId).sortBy("order");
    expect(list.map((c) => [c.name, c.value, c.target])).toEqual([
      ["身頃", 2, 120],
      ["左袖", 0, undefined],
    ]);
    await resetCounter(body, db);
    expect((await db.counters.get(body))!.value).toBe(0);
  });

  it("名前・目標の編集と削除", async () => {
    const id = await createCounter(patternId, "模様", undefined, db);
    await updateCounter(id, { name: "模様編みA", target: 24, value: 5 }, db);
    expect(await db.counters.get(id)).toMatchObject({ name: "模様編みA", target: 24, value: 5 });
    await updateCounter(id, { target: null }, db);
    expect((await db.counters.get(id))!.target).toBeUndefined();
    await expect(updateCounter(id, { target: -3 }, db)).rejects.toBeInstanceOf(UserFacingError);
    await expect(updateCounter(id, { name: " " }, db)).rejects.toBeInstanceOf(UserFacingError);
    await deleteCounter(id, db);
    expect(await db.counters.get(id)).toBeUndefined();
  });

  it("DBを開き直しても値が保持される（再起動相当）", async () => {
    const id = await createCounter(patternId, "減目", undefined, db);
    await stepCounter(id, 7, db);
    const name = db.name;
    db.close();
    const reopened = new LibraryDB(name);
    await reopened.open();
    expect((await reopened.counters.get(id))!.value).toBe(7);
    db = reopened;
  });
});

describe("作品メモ", () => {
  it("保存と空にした場合の削除", async () => {
    await updatePatternNotes(patternId, "2号針に変更", db);
    expect((await db.patterns.get(patternId))!.notes).toBe("2号針に変更");
    await updatePatternNotes(patternId, "  ", db);
    expect((await db.patterns.get(patternId))!.notes).toBeUndefined();
  });
});

describe("注釈", () => {
  it("ページ単位で保存・編集・削除できる", async () => {
    const fileId = "f1";
    const ink = await addAnnotation({ type: "ink", fileId, page: 1, points: [0.1, 0.1, 0.5, 0.1], color: "#ff0", width: 0.02, opacity: 0.4 }, db);
    const note = await addAnnotation({ type: "note", fileId, page: 1, x: 0.5, y: 0.5, text: "ここで減目" }, db);
    await addAnnotation({ type: "note", fileId, page: 2, x: 0.5, y: 0.5, text: "2ページ目" }, db);
    await addAnnotation({ type: "note", fileId: "other", page: 1, x: 0.5, y: 0.5, text: "別ファイル" }, db);

    await updateNoteText(note, "ここで2目減らす", db);
    expect(await db.annotations.get(note)).toMatchObject({ text: "ここで2目減らす", x: 0.5 });

    await deleteAnnotation(ink, db);
    await deletePageAnnotations(fileId, 1, db);
    const rest = await db.annotations.toArray();
    expect(rest.map((a) => (a.type === "note" ? a.text : "")).sort()).toEqual(["2ページ目", "別ファイル"]);
  });
});

describe("定規の保存", () => {
  it("ファイルごとに保存され、バックアップで失われない", async () => {
    const { saveRuler, addFilesToPattern } = await import("./repo");
    const { createBackup, parseBackup, restoreBackup, wipeAllData } = await import("../lib/backup");
    const pdf = new TextEncoder().encode("%PDF-1.7\nx").buffer as ArrayBuffer;
    const [fileId] = await addFilesToPattern(patternId, [{ name: "chart.pdf", kind: "chart", mimeType: "application/pdf", data: pdf }], db);
    await saveRuler(fileId, { page: 2, y: 0.4, height: 0.03, visible: true, counterId: "c1" }, db);
    const blob = await createBackup({ includeFiles: true }, db);
    await wipeAllData(db);
    await restoreBackup(await parseBackup(blob), "replace", db);
    const f = (await db.files.toArray())[0];
    expect(f.ruler).toEqual({ page: 2, y: 0.4, height: 0.03, visible: true, counterId: "c1" });
  });
});
