import { describe, expect, it } from "vitest";
import {
  canAddPattern,
  FREE_PATTERN_LIMIT,
  hasActiveLegacySubscription,
  isPremiumActive,
  LEGACY_SUBSCRIPTION_ID,
  PREMIUM_PRODUCT_ID,
  type Entitlement,
} from "./premium";

describe("無料版の登録数の上限", () => {
  it("5件までは無料で登録でき、6件目からはプレミアムが必要", () => {
    expect(FREE_PATTERN_LIMIT).toBe(5);
    expect(canAddPattern(0, false)).toBe(true);
    expect(canAddPattern(4, false)).toBe(true);
    expect(canAddPattern(5, false)).toBe(false);
    expect(canAddPattern(12, false)).toBe(false);
  });

  it("作品を削除して5件未満に戻れば、また登録できる", () => {
    expect(canAddPattern(5, false)).toBe(false);
    expect(canAddPattern(5 - 1, false)).toBe(true);
  });

  it("プレミアムなら上限なし", () => {
    expect(canAddPattern(5, true)).toBe(true);
    expect(canAddPattern(500, true)).toBe(true);
  });
});

describe("プレミアムの有効判定（買い切り）", () => {
  const now = 1_000_000;
  const status = (entitlements: Entitlement[], purchasedProductIds: string[] = []) => ({ entitlements, purchasedProductIds });

  it("買い切りを購入していれば有効（期限はない）", () => {
    expect(isPremiumActive(status([{ productId: PREMIUM_PRODUCT_ID, purchaseDate: 0 }]))).toBe(true);
    expect(isPremiumActive(status([], [PREMIUM_PRODUCT_ID]))).toBe(true);
  });

  it("以前の月額プランを一度でも購入していれば、期限が切れても有効", () => {
    expect(isPremiumActive(status([{ productId: LEGACY_SUBSCRIPTION_ID, purchaseDate: 0, expirationDate: now + 1 }]))).toBe(true);
    expect(isPremiumActive(status([], [LEGACY_SUBSCRIPTION_ID]))).toBe(true);
  });

  it("別の商品・購入なしは無効", () => {
    expect(isPremiumActive(status([{ productId: "other", purchaseDate: 0 }], ["other"]))).toBe(false);
    expect(isPremiumActive(status([]))).toBe(false);
    expect(isPremiumActive({ entitlements: [] })).toBe(false);
  });

  it("月額プランが有効なままなら解約を案内する（期限切れ・解約済みなら案内しない）", () => {
    expect(hasActiveLegacySubscription(status([{ productId: LEGACY_SUBSCRIPTION_ID, purchaseDate: 0, expirationDate: now + 1 }]), now)).toBe(true);
    expect(hasActiveLegacySubscription(status([], [LEGACY_SUBSCRIPTION_ID]), now)).toBe(false);
    expect(hasActiveLegacySubscription(status([{ productId: PREMIUM_PRODUCT_ID, purchaseDate: 0 }]), now)).toBe(false);
  });
});
