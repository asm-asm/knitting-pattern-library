import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useFeedback } from "./Feedback";
import { ExternalLinkButton } from "./Inputs";
import {
  FREE_PATTERN_LIMIT,
  PRIVACY_URL,
  TERMS_URL,
  getPremiumState,
  loadPremiumProduct,
  purchasePremium,
  restorePurchases,
  subscribePremium,
  type StoreProduct,
} from "../lib/premium";
import { formatDate } from "../lib/format";

export function usePremium() {
  return useSyncExternalStore(subscribePremium, getPremiumState);
}

const PERIOD_ONE: Record<string, string> = { day: "日", week: "週", month: "月", year: "年" };
const PERIOD_MANY: Record<string, string> = { day: "日", week: "週間", month: "か月", year: "年" };

/**
 * プレミアムの案内と購入画面。
 * reason="limit"：6件目を登録しようとしたとき／"info"：設定から開いたとき
 */
export function Paywall({ reason, patternCount, onClose }: { reason: "limit" | "info"; patternCount?: number; onClose?: () => void }) {
  const premium = usePremium();
  const { toast, showError } = useFeedback();
  const [product, setProduct] = useState<StoreProduct | null>();
  // 商品を読み込めなかった理由：network＝通信の失敗、unavailable＝App Store から商品が返ってこない
  const [loadError, setLoadError] = useState<"network" | "unavailable">();
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProduct(undefined);
    setLoadError(undefined);
    loadPremiumProduct()
      .then((p) => {
        if (cancelled) return;
        setProduct(p ?? null);
        if (!p) setLoadError("unavailable");
      })
      .catch(() => {
        if (cancelled) return;
        setProduct(null);
        setLoadError("network");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const period = product?.period
    ? product.period.value === 1
      ? PERIOD_ONE[product.period.unit]
      : `${product.period.value}${PERIOD_MANY[product.period.unit]}`
    : "月";
  const priceLabel = product ? `${product.displayPrice} / ${period}` : "月額 150円";

  if (premium.active) {
    return (
      <div className="paywall">
        <div className="paywall-badge">プレミアム</div>
        <h2 className="paywall-title">プレミアムをご利用中です</h2>
        <p>作品の登録数に上限はありません。</p>
        {premium.expiresAt && <p className="muted small">次回の自動更新日：{formatDate(premium.expiresAt)}</p>}
        <p className="muted small">解約や支払い方法の変更は、設定画面の「サブスクリプションを管理」から行えます。</p>
        {onClose && (
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
            作品の登録に進む
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="paywall">
      <div className="paywall-badge">プレミアム</div>
      <h2 className="paywall-title">{reason === "limit" ? `無料で登録できるのは${FREE_PATTERN_LIMIT}件までです` : "作品を何件でも登録できます"}</h2>
      {reason === "limit" && (
        <p>
          いま登録されている作品は{patternCount ?? FREE_PATTERN_LIMIT}件です。6件目以降を登録するには、プレミアム（{priceLabel}）にお申し込みください。
        </p>
      )}

      <ul className="paywall-list">
        <li>作品の登録数が<strong>無制限</strong>になります</li>
        <li>登録済みの作品の閲覧・編集・PDF・段数カウンターは、これまでどおり無料で使えます</li>
        <li>作品を削除すれば、無料版でもまた新しく登録できます</li>
      </ul>

      {product === null && (
        <div className="note-box">
          <p>
            {loadError === "unavailable"
              ? "現在、プレミアムをご購入いただけない状態です。しばらくしてからもう一度お試しください。"
              : "購入情報を読み込めませんでした。インターネットに接続しているか確認してください。"}
          </p>
          <button type="button" className="btn btn-small" onClick={() => setReload((n) => n + 1)}>
            もう一度読み込む
          </button>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block paywall-buy"
        disabled={!product || !!busy}
        onClick={async () => {
          setBusy("buy");
          try {
            const status = await purchasePremium();
            if (status === "purchased") toast("プレミアムに登録しました。ありがとうございます！");
            else if (status === "pending") toast("購入の承認待ちです。承認されると自動で有効になります。");
          } catch (e) {
            showError(e, "購入を完了できませんでした。時間をおいてもう一度お試しください。");
          } finally {
            setBusy(null);
          }
        }}
      >
        {busy === "buy" ? "処理中…" : product ? `${priceLabel} で登録する` : product === null ? "現在は購入できません" : "読み込み中…"}
      </button>

      <button
        type="button"
        className="btn btn-block"
        disabled={!!busy}
        onClick={async () => {
          setBusy("restore");
          try {
            const ok = await restorePurchases();
            toast(ok ? "購入を復元しました" : "復元できる購入が見つかりませんでした", ok ? "info" : "error");
          } catch (e) {
            showError(e, "購入を復元できませんでした。時間をおいてもう一度お試しください。");
          } finally {
            setBusy(null);
          }
        }}
      >
        {busy === "restore" ? "確認中…" : "購入を復元する"}
      </button>

      {reason === "limit" && (
        <Link to="/library" className="btn btn-ghost btn-block">
          登録済みの作品を整理する
        </Link>
      )}

      <p className="paywall-legal">
        お支払いは購入の確定時に Apple ID に請求されます。サブスクリプションは、現在の期間が終了する24時間前までに解約しない限り、同じ料金で自動的に更新されます。解約は、iPhone の「設定」→ ご自身の名前 →「サブスクリプション」から行えます。
      </p>
      <div className="paywall-links">
        <ExternalLinkButton url={TERMS_URL} label="利用規約（EULA）" pageName="利用規約" className="btn btn-ghost btn-small" />
        <ExternalLinkButton url={PRIVACY_URL} label="プライバシーポリシー" pageName="プライバシーポリシー" className="btn btn-ghost btn-small" />
      </div>
    </div>
  );
}
