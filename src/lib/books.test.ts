import { describe, expect, it } from "vitest";
import { formatIsbn, normalizeIsbn } from "./isbn";
import { cleanAuthor, parseGoogleBooks, parseOpenBD } from "./bookLookup";

describe("ISBN", () => {
  it("ISBN-13 をそのまま・ハイフンや全角があっても読める", () => {
    expect(normalizeIsbn("9784529058834")).toBe("9784529058834");
    expect(normalizeIsbn("978-4-529-05883-4")).toBe("9784529058834");
    expect(normalizeIsbn("９７８４５２９０５８８３４")).toBe("9784529058834");
  });
  it("ISBN-10 は ISBN-13 に変換する", () => {
    expect(normalizeIsbn("4-529-05883-X")).toBeUndefined(); // チェック数字が違う
    expect(normalizeIsbn("0-306-40615-2")).toBe("9780306406157");
    expect(normalizeIsbn("080442957X")).toBe("9780804429573");
  });
  it("間違った番号・本以外のバーコードは受け付けない", () => {
    expect(normalizeIsbn("9784529058839")).toBeUndefined();
    expect(normalizeIsbn("4901234567894")).toBeUndefined(); // 一般商品の JAN コード
    expect(normalizeIsbn("")).toBeUndefined();
  });
  it("表示用の形", () => {
    expect(formatIsbn("9784529058838")).toBe("978-4529058838");
  });
});

describe("本の情報の読み取り", () => {
  it("openBD", () => {
    const json = [
      {
        summary: {
          isbn: "9784529058838",
          title: "はじめての棒針編み",
          volume: "2",
          publisher: "日本ヴォーグ社",
          author: "山田花子／著 鈴木太郎／監修",
          cover: "http://cover.openbd.jp/9784529058838.jpg",
        },
      },
    ];
    expect(parseOpenBD(json)).toEqual({
      title: "はじめての棒針編み 2",
      author: "山田花子、鈴木太郎",
      publisher: "日本ヴォーグ社",
      coverUrl: "https://cover.openbd.jp/9784529058838.jpg",
    });
    expect(parseOpenBD([null])).toBeUndefined();
  });

  it("Google Books", () => {
    const json = {
      items: [{ volumeInfo: { title: "Knitting Without Tears", authors: ["Elizabeth Zimmermann"], publisher: "Scribner", imageLinks: { thumbnail: "http://books.google.com/x.jpg" } } }],
    };
    expect(parseGoogleBooks(json)).toEqual({
      title: "Knitting Without Tears",
      author: "Elizabeth Zimmermann",
      publisher: "Scribner",
      coverUrl: "https://books.google.com/x.jpg",
    });
    expect(parseGoogleBooks({ totalItems: 0 })).toBeUndefined();
  });

  it("著者名から役割の表記を取り除く", () => {
    expect(cleanAuthor("日本ヴォーグ社／編")).toBe("日本ヴォーグ社");
    expect(cleanAuthor("A／著 A／絵")).toBe("A");
    expect(cleanAuthor(undefined)).toBeUndefined();
    expect(cleanAuthor("宮沢,賢治,1896-1933")).toBe("宮沢賢治");
    expect(cleanAuthor("宮沢, 賢治, 1896-1933".replace(/, /g, ","))).toBe("宮沢賢治");
    expect(cleanAuthor("Zimmermann,Elizabeth")).toBe("Elizabeth Zimmermann");
  });
});

import { afterEach, beforeEach } from "vitest";
import { LibraryDB } from "../db/db";
import { createPattern, UserFacingError } from "../db/repo";
import { createBackup, parseBackup, restoreBackup, wipeAllData } from "./backup";
import { DEFAULT_QUERY, searchPatterns } from "./search";
import { canAddBook, countByKind, FREE_BOOK_LIMIT } from "./premium";
import { newId } from "./id";

describe("本・電子書籍の登録", () => {
  let db: LibraryDB;
  beforeEach(async () => {
    db = new LibraryDB("test-" + newId());
    await db.open();
  });
  afterEach(async () => {
    await db.delete();
  });
  const base = { status: "want" as const, favorite: false, categoryIds: [], tags: [] };

  it("ISBN は13桁に揃えて保存し、間違った番号は保存しない", async () => {
    const id = await createPattern({ ...base, title: "棒針の本", itemType: "book", isbn: "0-306-40615-2", author: "著者" }, [], undefined, db);
    expect((await db.patterns.get(id))!.isbn).toBe("9780306406157");
    await expect(createPattern({ ...base, title: "x", itemType: "book", isbn: "123" }, [], undefined, db)).rejects.toBeInstanceOf(UserFacingError);
  });

  it("本の情報と、作品と本の結び付きがバックアップで失われない", async () => {
    const book = await createPattern({ ...base, title: "北欧ニット", itemType: "book", author: "山田", publisher: "出版社", isbn: "9780306406157" }, [], undefined, db);
    await createPattern({ ...base, title: "電子版", itemType: "ebook", ebookUrl: "https://example.com/ebook" }, [], undefined, db);
    await createPattern({ ...base, title: "ミトン", sourceBookId: book, sourcePage: "24" }, [], undefined, db);
    const blob = await createBackup({ includeFiles: false }, db);
    await wipeAllData(db);
    await restoreBackup(await parseBackup(blob), "replace", db);
    const all = await db.patterns.toArray();
    expect(all.find((p) => p.title === "北欧ニット")).toMatchObject({ itemType: "book", author: "山田", publisher: "出版社", isbn: "9780306406157" });
    expect(all.find((p) => p.title === "電子版")).toMatchObject({ itemType: "ebook", ebookUrl: "https://example.com/ebook" });
    expect(all.find((p) => p.title === "ミトン")).toMatchObject({ sourceBookId: book, sourcePage: "24" });
  });

  it("本を削除しても作品は残り、掲載情報だけが外れる", async () => {
    const { deletePattern, getPatternDeletionSummary } = await import("../db/repo");
    const book = await createPattern({ ...base, title: "本", itemType: "book" }, [], undefined, db);
    const p = await createPattern({ ...base, title: "作品", sourceBookId: book, sourcePage: "12" }, [], undefined, db);
    expect((await getPatternDeletionSummary(book, db)).linkedPatterns).toBe(1);
    await deletePattern(book, db);
    const after = (await db.patterns.get(p))!;
    expect(after.title).toBe("作品");
    expect(after.sourceBookId).toBeUndefined();
    expect(after.sourcePage).toBeUndefined();
  });

  it("種類で絞り込め、著者・出版社でも検索できる", async () => {
    const items = [
      { id: "1", title: "セーター", itemType: undefined },
      { id: "2", title: "北欧ニット", itemType: "book" as const, author: "山田花子" },
      { id: "3", title: "電子版", itemType: "ebook" as const, publisher: "ヴォーグ" },
    ].map((x) => ({ ...base, createdAt: 0, updatedAt: 0, ...x }));
    const run = (q: Partial<typeof DEFAULT_QUERY>) => searchPatterns(items, [], [], { ...DEFAULT_QUERY, ...q }).map((p) => p.id).sort();
    expect(run({ itemType: "book" })).toEqual(["2"]);
    expect(run({ itemType: "pattern" })).toEqual(["1"]);
    expect(run({ text: "山田" })).toEqual(["2"]);
    expect(run({ text: "ヴォーグ" })).toEqual(["3"]);
  });
});

describe("本の無料の上限", () => {
  it("編み図とは別に、本・電子書籍は5冊まで無料", () => {
    expect(FREE_BOOK_LIMIT).toBe(5);
    expect(countByKind([{}, { itemType: "pattern" }, { itemType: "book" }, { itemType: "ebook" }])).toEqual({ patterns: 2, books: 2 });
    expect(canAddBook(4, false)).toBe(true);
    expect(canAddBook(5, false)).toBe(false);
    expect(canAddBook(5, true)).toBe(true);
  });
});
