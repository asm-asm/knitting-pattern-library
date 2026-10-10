import Dexie, { type EntityTable } from "dexie";
import type { Annotation, Category, Counter, Pattern, PatternFile, StoredBlob } from "./types";

export class LibraryDB extends Dexie {
  patterns!: EntityTable<Pattern, "id">;
  files!: EntityTable<PatternFile, "id">;
  /** ブラウザ版のファイル実体。iOS アプリ版では移行前の古いデータだけが残る */
  blobs!: EntityTable<StoredBlob, "id">;
  categories!: EntityTable<Category, "id">;
  counters!: EntityTable<Counter, "id">;
  annotations!: EntityTable<Annotation, "id">;

  private mutationListeners = new Set<(table: string, type: string) => void>();

  constructor(name = "knitting-pattern-library") {
    super(name);
    this.version(1).stores({
      patterns: "id, createdAt, updatedAt, lastOpenedAt, status, *tags, *categoryIds",
      files: "id, patternId, blobId",
      blobs: "id",
      categories: "id, order",
      counters: "id, patternId",
      annotations: "id, fileId, [fileId+page]",
    });
    // すべての書き込み（追加・更新・削除）を検知して、自動の控え保存に知らせる
    this.use({
      stack: "dbcore",
      name: "mutation-notify",
      create: (down) => ({
        ...down,
        table: (tableName) => {
          const table = down.table(tableName);
          return {
            ...table,
            mutate: async (req) => {
              const res = await table.mutate(req);
              this.mutationListeners.forEach((l) => l(tableName, req.type));
              return res;
            },
          };
        },
      }),
    });
  }

  /** 書き込みがあったときに呼ばれる関数を登録する。戻り値で解除。 */
  onMutation(fn: (table: string, type: string) => void) {
    this.mutationListeners.add(fn);
    return () => void this.mutationListeners.delete(fn);
  }
}

export const db = new LibraryDB();
