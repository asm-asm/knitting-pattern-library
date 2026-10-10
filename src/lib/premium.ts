// プレミアム（月額サブスクリプション）。
// 無料版は作品を5件まで登録できる。作品を削除すれば、また登録できる。
// 登録済みの作品の閲覧・編集・PDF・カウンターは、課金状態に関係なくいつでも使える（オフラインでも）。
// 購入の確認は端末内の StoreKit で行い、購入情報を外部へ送らない。
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNativeApp } from "./native";

export const FREE_PATTERN_LIMIT = 5;
/** 本・電子書籍は編み図とは別に5冊まで無料 */
export const FREE_BOOK_LIMIT = 5;
export const PREMIUM_PRODUCT_ID = "com.sammy.knittinglibrary.premiumplan.monthly";
export const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
export const PRIVACY_URL = "https://asm-asm.github.io/knitting-library-support/privacy.html";

export interface Entitlement {
  productId: string;
  purchaseDate: number;
  expirationDate?: number;
}

export interface StoreProduct {
  id: string;
  displayName: string;
  description: string;
  displayPrice: string;
  price: number;
  period?: { unit: "day" | "week" | "month" | "year"; value: number };
}

interface StorePlugin {
  getProducts(o: { productIds: string[] }): Promise<{ products: StoreProduct[] }>;
  purchase(o: { productId: string }): Promise<{ status: "purchased" | "cancelled" | "pending" | "unknown"; entitlements?: Entitlement[] }>;
  getEntitlements(): Promise<{ entitlements: Entitlement[] }>;
  restore(): Promise<{ entitlements: Entitlement[] }>;
  manageSubscriptions(): Promise<void>;
  addListener(event: "entitlementsChanged", fn: (d: { entitlements: Entitlement[] }) => void): Promise<PluginListenerHandle>;
}

const Store = registerPlugin<StorePlugin>("Store");

/** 作品をもう1件登録できるか */
export function canAddPattern(patternCount: number, premium: boolean): boolean {
  return premium || patternCount < FREE_PATTERN_LIMIT;
}

/** 本・電子書籍をもう1冊登録できるか */
export function canAddBook(bookCount: number, premium: boolean): boolean {
  return premium || bookCount < FREE_BOOK_LIMIT;
}

/** 種類ごとの登録数（本・電子書籍はまとめて数える） */
export function countByKind(items: { itemType?: string }[]): { patterns: number; books: number } {
  let books = 0;
  for (const p of items) if (p.itemType === "book" || p.itemType === "ebook") books++;
  return { patterns: items.length - books, books };
}

export function isPremiumActive(entitlements: Entitlement[], now = Date.now()): boolean {
  return entitlements.some((e) => e.productId === PREMIUM_PRODUCT_ID && (e.expirationDate === undefined || e.expirationDate > now));
}

// ---- 状態（画面から購読できるようにする） ----

export interface PremiumState {
  /** 登録数の上限を適用するか（iOS アプリのみ。ブラウザ版は購入できないため上限なし） */
  enforced: boolean;
  active: boolean;
  /** 有効期限（自動更新の次回日） */
  expiresAt?: number;
  /** 起動直後でまだ確認中 */
  checking: boolean;
}

const CACHE_KEY = "kpl.premium";
let state: PremiumState = { enforced: false, active: false, checking: false };
const listeners = new Set<() => void>();

function setState(s: Partial<PremiumState>) {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
}

export function getPremiumState() {
  return state;
}

export function subscribePremium(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function applyEntitlements(ents: Entitlement[]) {
  const mine = ents.filter((e) => e.productId === PREMIUM_PRODUCT_ID);
  const active = isPremiumActive(mine);
  const expiresAt = mine.reduce<number | undefined>((m, e) => (e.expirationDate && (!m || e.expirationDate > m) ? e.expirationDate : m), undefined);
  setState({ active, expiresAt, checking: false });
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ active, expiresAt, checkedAt: Date.now() }));
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

/** 前回確認した結果（StoreKit に問い合わせられないときの予備） */
function cachedState(now = Date.now()): { active: boolean; expiresAt?: number } {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { active: boolean; expiresAt?: number } | null;
    if (!c?.active) return { active: false };
    return { active: c.expiresAt === undefined || c.expiresAt > now, expiresAt: c.expiresAt };
  } catch {
    return { active: false };
  }
}

export async function initPremium() {
  if (!isNativeApp()) return;
  setState({ enforced: true, checking: true, ...cachedState() });
  try {
    await Store.addListener("entitlementsChanged", ({ entitlements }) => applyEntitlements(entitlements));
    const { entitlements } = await Store.getEntitlements();
    applyEntitlements(entitlements);
  } catch (e) {
    console.warn("entitlement check failed", e);
    setState({ checking: false });
  }
}

export async function loadPremiumProduct(): Promise<StoreProduct | undefined> {
  if (import.meta.env.DEV && previewProduct) return previewProduct;
  // App Store から返事がないまま待ち続けないよう、20秒で打ち切る
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000));
  const { products } = await Promise.race([Store.getProducts({ productIds: [PREMIUM_PRODUCT_ID] }), timeout]);
  return products[0];
}

export async function purchasePremium() {
  const r = await Store.purchase({ productId: PREMIUM_PRODUCT_ID });
  if (r.entitlements) applyEntitlements(r.entitlements);
  return r.status;
}

export async function restorePurchases() {
  const { entitlements } = await Store.restore();
  applyEntitlements(entitlements);
  return state.active;
}

export function manageSubscriptions() {
  return Store.manageSubscriptions();
}

// ---- ストア用スクリーンショットの作成専用（開発サーバーでのみ動く。本番のアプリには影響しない） ----
let previewProduct: StoreProduct | undefined;
export function __previewPremium(s: Partial<PremiumState>, product?: StoreProduct) {
  if (!import.meta.env.DEV) return;
  previewProduct = product;
  setState(s);
}
