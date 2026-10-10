// 作品情報・カウンター・メモ・書き込みの「控え」を自動で保存し、データが失われたときに復元する。
// 控えは2つのファイル（A/B）に交互に書き、読むときは新しい方を使う。書き込み中に止まっても片方は無事に残る。
import type { LibraryDB } from "../db/db";
import { cleanBackupData, readAllData } from "../lib/backup";

export const SNAPSHOT_FORMAT = "knitting-library-snapshot";

/** 控えの読み書き先（iOS ではアプリ専用フォルダ、テストではメモリ） */
export interface SnapshotIO {
  read(slot: "a" | "b"): Promise<string | undefined>;
  write(slot: "a" | "b", text: string): Promise<void>;
}

interface SnapshotFile {
  format: typeof SNAPSHOT_FORMAT;
  version: 1;
  savedAt: number;
  seq: number;
  data: unknown;
}

async function readSlot(io: SnapshotIO, slot: "a" | "b"): Promise<SnapshotFile | undefined> {
  try {
    const text = await io.read(slot);
    if (!text) return undefined;
    const s = JSON.parse(text) as SnapshotFile;
    return s?.format === SNAPSHOT_FORMAT && s.data && typeof s.data === "object" ? s : undefined;
  } catch {
    return undefined; // 書きかけ・壊れた控えは使わない
  }
}

export async function readLatestSnapshot(io: SnapshotIO): Promise<SnapshotFile | undefined> {
  const [a, b] = await Promise.all([readSlot(io, "a"), readSlot(io, "b")]);
  if (!a) return b;
  if (!b) return a;
  return b.seq > a.seq ? b : a;
}

export class SnapshotWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private dirty = false;
  private seq = 0;
  private nextSlot: "a" | "b" = "a";
  private unsubscribe: (() => void) | undefined;
  /** 最後に控えを保存した日時 */
  lastSavedAt: number | undefined;

  constructor(
    private db: LibraryDB,
    private io: SnapshotIO,
    private delayMs = 1000,
  ) {}

  /** 既存の控えの続き番号から書き始め、書き込みの監視を開始する */
  async start() {
    const latest = await readLatestSnapshot(this.io);
    if (latest) {
      this.seq = latest.seq;
      this.lastSavedAt = latest.savedAt;
      // 最新でない方に次を書く
      const a = await readSlot(this.io, "a");
      this.nextSlot = a && a.seq === latest.seq ? "b" : "a";
    }
    this.unsubscribe = this.db.onMutation((table, type) => {
      if (table === "blobs") return;
      // 削除はすぐに控えへ反映する（直後にアプリが終了しても、消したものが復元されないように）
      this.schedule(type === "delete" || type === "deleteRange" ? 50 : this.delayMs);
    });
  }

  stop() {
    this.unsubscribe?.();
    clearTimeout(this.timer);
  }

  schedule(delay = this.delayMs) {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** 未保存の変更があればすぐに保存する（アプリを閉じるとき・全削除の直後など） */
  async flush(force = false): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) await this.running;
    if (!this.dirty && !force) return;
    this.dirty = false;
    this.running = (async () => {
      try {
        const data = await readAllData(this.db);
        const snap: SnapshotFile = { format: SNAPSHOT_FORMAT, version: 1, savedAt: Date.now(), seq: this.seq + 1, data };
        await this.io.write(this.nextSlot, JSON.stringify(snap));
        this.seq = snap.seq;
        this.lastSavedAt = snap.savedAt;
        this.nextSlot = this.nextSlot === "a" ? "b" : "a";
      } catch (e) {
        this.dirty = true; // 次の機会に再挑戦する
        console.warn("snapshot failed", e);
      }
    })();
    await this.running;
    this.running = undefined;
  }
}

export interface RecoveryResult {
  patterns: number;
  files: number;
}

/**
 * データベースが空なのに控えがある場合（iOS にデータを消された場合など）は、控えから自動で戻す。
 * データベースに作品・ファイルが1件でもあれば何もしない。
 */
export async function recoverFromSnapshot(db: LibraryDB, io: SnapshotIO): Promise<RecoveryResult | undefined> {
  if ((await db.patterns.count()) > 0 || (await db.files.count()) > 0) return undefined;
  const snap = await readLatestSnapshot(io);
  if (!snap) return undefined;
  const { data } = cleanBackupData(snap.data as Record<string, unknown>);
  if (!data.patterns.length) return undefined;
  await db.transaction("rw", [db.patterns, db.files, db.categories, db.counters, db.annotations], async () => {
    // 初回起動で入る基本カテゴリと重ならないよう、カテゴリも控えの内容に揃える
    await db.categories.clear();
    await db.categories.bulkPut(data.categories);
    await db.patterns.bulkPut(data.patterns);
    await db.files.bulkPut(data.files);
    await db.counters.bulkPut(data.counters);
    await db.annotations.bulkPut(data.annotations);
  });
  return { patterns: data.patterns.length, files: data.files.length };
}

/** テスト用 */
export class MemorySnapshotIO implements SnapshotIO {
  slots: Record<string, string | undefined> = {};
  async read(slot: "a" | "b") {
    return this.slots[slot];
  }
  async write(slot: "a" | "b", text: string) {
    this.slots[slot] = text;
  }
}
