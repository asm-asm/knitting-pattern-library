import Dexie, { type EntityTable } from "dexie";
import type { Annotation, Category, Counter, Pattern, PatternFile, StoredBlob } from "./types";

export class LibraryDB extends Dexie {
  patterns!: EntityTable<Pattern, "id">;
  files!: EntityTable<PatternFile, "id">;
  blobs!: EntityTable<StoredBlob, "id">;
  categories!: EntityTable<Category, "id">;
  counters!: EntityTable<Counter, "id">;
  annotations!: EntityTable<Annotation, "id">;

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
  }
}

export const db = new LibraryDB();
