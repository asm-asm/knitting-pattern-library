// 「これ持ってる？」で調べた本を、そのまま新規登録画面に引き継ぐ
import type { ItemType } from "../db/types";

export interface BookPrefill {
  itemType: ItemType;
  isbn?: string;
  title?: string;
  author?: string;
  publisher?: string;
  coverUrl?: string;
}

let pending: BookPrefill | undefined;

export function setBookPrefill(p: BookPrefill) {
  pending = p;
}
export function peekBookPrefill(): BookPrefill | undefined {
  return pending;
}
export function clearBookPrefill() {
  pending = undefined;
}
