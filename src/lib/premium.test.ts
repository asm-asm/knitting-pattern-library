import { describe, expect, it } from "vitest";
import { canAddPattern, FREE_PATTERN_LIMIT, isPremiumActive, PREMIUM_PRODUCT_ID } from "./premium";

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

describe("プレミアムの有効判定", () => {
  const now = 1_000_000;
  it("有効期限内のサブスクリプションがあれば有効", () => {
    expect(isPremiumActive([{ productId: PREMIUM_PRODUCT_ID, purchaseDate: 0, expirationDate: now + 1 }], now)).toBe(true);
  });
  it("期限切れ・別の商品・購入なしは無効", () => {
    expect(isPremiumActive([{ productId: PREMIUM_PRODUCT_ID, purchaseDate: 0, expirationDate: now - 1 }], now)).toBe(false);
    expect(isPremiumActive([{ productId: "other", purchaseDate: 0, expirationDate: now + 1 }], now)).toBe(false);
    expect(isPremiumActive([], now)).toBe(false);
  });
});
