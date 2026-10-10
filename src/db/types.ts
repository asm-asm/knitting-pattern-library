// データモデル定義。すべて端末内（IndexedDB）に保存され、外部へは送信しない。

/** 制作ステータス。お気に入りはステータスとは独立したフラグ（Pattern.favorite）で管理する。 */
export type PatternStatus = "want" | "preparing" | "in_progress" | "paused" | "done";

export const STATUS_ORDER: PatternStatus[] = ["want", "preparing", "in_progress", "paused", "done"];

export const STATUS_LABELS: Record<PatternStatus, string> = {
  want: "編みたい",
  preparing: "準備中",
  in_progress: "制作中",
  paused: "一時中断",
  done: "完成",
};

export type FileKind = "original" | "translation" | "revised" | "chart" | "supplement" | "other";

export const FILE_KIND_ORDER: FileKind[] = ["original", "translation", "revised", "chart", "supplement", "other"];

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  original: "英語原本",
  translation: "日本語翻訳版",
  revised: "修正版",
  chart: "編み図チャート",
  supplement: "補足資料",
  other: "その他",
};

/** 作品（1つの編み図） */
export interface Pattern {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 作品詳細またはファイルを最後に開いた日時 */
  lastOpenedAt?: number;
  status: PatternStatus;
  favorite: boolean;
  categoryIds: string[];
  tags: string[];
  /** 表紙画像（blobs テーブルの ID） */
  coverBlobId?: string;
  purchaseUrl?: string;
  shopName?: string;
  designer?: string;
  /** YYYY-MM-DD */
  purchaseDate?: string;
  price?: number;
  currency?: string;
  yarn?: string;
  needles?: string;
  size?: string;
  gauge?: string;
  difficulty?: string;
  notes?: string;
}

/** PDF 内の閲覧位置。ファイルごとに独立して保存する。 */
export interface ViewState {
  page: number;
  zoom: number;
  /** スクロール位置（ページ幅・高さに対する 0〜1 の割合） */
  scrollXRatio: number;
  scrollYRatio: number;
}

/** 作品に関連付けられたファイル（原本・翻訳版など） */
export interface PatternFile {
  id: string;
  patternId: string;
  name: string;
  kind: FileKind;
  mimeType: string;
  size: number;
  createdAt: number;
  /** 実体データ（blobs テーブルの ID）。メタデータと実体は分離して保存する。 */
  blobId: string;
  pageCount?: number;
  viewState?: ViewState;
  lastOpenedAt?: number;
}

/** ファイル実体。他の作品・ファイルと共有しない（1ファイル=1実体）。 */
export interface StoredBlob {
  id: string;
  type: string;
  data: ArrayBuffer;
}

export interface Category {
  id: string;
  name: string;
  order: number;
  createdAt: number;
}

/** 段数カウンター（作品単位） */
export interface Counter {
  id: string;
  patternId: string;
  name: string;
  value: number;
  target?: number;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * PDF 上の注釈（ファイル単位・ページ単位）。
 * 座標はページサイズに対する 0〜1 の割合で保存し、倍率や画面サイズが変わってもずれないようにする。
 */
export type Annotation =
  | AnnotationBase & { type: "highlight"; x: number; y: number; w: number; h: number; color: string }
  | AnnotationBase & { type: "ink"; points: number[]; color: string; width: number }
  | AnnotationBase & { type: "note"; x: number; y: number; text: string };

interface AnnotationBase {
  id: string;
  fileId: string;
  page: number;
  createdAt: number;
  updatedAt: number;
}
