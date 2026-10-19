// プレミアム（買い切り 500円）。
// 無料版は作品5件・本と電子書籍5冊まで登録できる。削除すれば、また登録できる。
// 以前の月額プラン（1.0〜1.1）を一度でも購入した人は、買い切りと同じく、ずっとプレミアムとして扱う。
// 登録済みの作品の閲覧・編集・PDF・カウンターは、課金状態に関係なくいつでも使える（オフラインでも）。
// 購入の確認は端末内の StoreKit で行い、購入情報を外部へ送らない。
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNativeApp } from "./native";

export const FREE_PATTERN_LIMIT = 5;
/** 本・電子書籍は編み図とは別に5冊まで無料 */
export const FREE_BOOK_LIMIT = 5;
/** 買い切り（非消耗型） */
export const PREMIUM_PRODUCT_ID = "com.sammy.knittinglibrary.premium.lifetime";
/** 以前の月額プラン（販売終了）。購入したことがあればプレミアム */
export const LEGACY_SUBSCRIPTION_ID = "com.sammy.knittinglibrary.premiumplan.monthly";
const PREMIUM_IDS = [PREMIUM_PRODUCT_ID, LEGACY_SUBSCRIPTION_ID];
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

/** 端末の StoreKit から受け取る購入状況 */
export interface StoreStatus {
  /** 現在有効な購入 */
  entitlements: Entitlement[];
  /** これまでに購入したことのある商品（返金されたものを除く） */
  purchasedProductIds?: string[];
}

interface StorePlugin {
  getProducts(o: { productIds: string[] }): Promise<{ products: StoreProduct[] }>;
  purchase(o: { productId: string }): Promise<{ status: "purchased" | "cancelled" | "pending" | "unknown" } & Partial<StoreStatus>>;
  getEntitlements(): Promise<StoreStatus>;
  restore(): Promise<StoreStatus>;
  manageSubscriptions(): Promise<void>;
  addListener(event: "entitlementsChanged", fn: (d: StoreStatus) => void): Promise<PluginListenerHandle>;
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

/** 買い切りを購入済み、または以前の月額プランを一度でも購入したことがあればプレミアム */
export function isPremiumActive(s: StoreStatus): boolean {
  return s.entitlements.some((e) => PREMIUM_IDS.includes(e.productId)) || (s.purchasedProductIds ?? []).some((id) => PREMIUM_IDS.includes(id));
}

/** 以前の月額プランがまだ有効（自動更新が続いている可能性がある）か。解約の案内に使う */
export function hasActiveLegacySubscription(s: StoreStatus, now = Date.now()): boolean {
  return s.entitlements.some((e) => e.productId === LEGACY_SUBSCRIPTION_ID && (e.expirationDate ?? 0) > now);
}

// ---- 状態（画面から購読できるようにする） ----

export interface PremiumState {
  /** 登録数の上限を適用するか（iOS アプリのみ。ブラウザ版は購入できないため上限なし） */
  enforced: boolean;
  active: boolean;
  /** 以前の月額プランが有効なまま（解約を案内する） */
  legacySubscription: boolean;
  /** 起動直後でまだ確認中 */
  checking: boolean;
}

const CACHE_KEY = "kpl.premium";
let state: PremiumState = { enforced: false, active: false, legacySubscription: false, checking: false };
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

function applyStatus(s: StoreStatus) {
  const active = isPremiumActive(s);
  const legacySubscription = hasActiveLegacySubscription(s);
  setState({ active, legacySubscription, checking: false });
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ active, checkedAt: Date.now() }));
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

/** 前回確認した結果（StoreKit に問い合わせられないときの予備）。買い切りなので期限はない */
function cachedState(): { active: boolean } {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { active?: boolean } | null;
    return { active: !!c?.active };
  } catch {
    return { active: false };
  }
}

export async function initPremium() {
  if (!isNativeApp()) return;
  setState({ enforced: true, checking: true, ...cachedState() });
  try {
    await Store.addListener("entitlementsChanged", applyStatus);
    applyStatus(await Store.getEntitlements());
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
  if (r.entitlements) applyStatus({ entitlements: r.entitlements, purchasedProductIds: r.purchasedProductIds });
  return r.status;
}

export async function restorePurchases() {
  applyStatus(await Store.restore());
  return state.active;
}

/** 以前の月額プランの解約画面（App Store のサブスクリプション管理） */
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
