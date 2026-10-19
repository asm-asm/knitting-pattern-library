import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useFeedback } from "./Feedback";
import { ExternalLinkButton } from "./Inputs";
import {
  FREE_BOOK_LIMIT,
  FREE_PATTERN_LIMIT,
  PRIVACY_URL,
  TERMS_URL,
  getPremiumState,
  loadPremiumProduct,
  manageSubscriptions,
  purchasePremium,
  restorePurchases,
  subscribePremium,
  type StoreProduct,
} from "../lib/premium";

export function usePremium() {
  return useSyncExternalStore(subscribePremium, getPremiumState);
}

/**
 * プレミアムの案内と購入画面。
 * reason="limit"：6件目を登録しようとしたとき／"info"：設定から開いたとき
 */
export function Paywall({
  reason,
  kind = "pattern",
  patternCount,
  onClose,
}: {
  reason: "limit" | "info";
  /** 上限に達したのが編み図か本か */
  kind?: "pattern" | "book";
  /** いまの登録数（kind に合わせた数） */
  patternCount?: number;
  onClose?: () => void;
}) {
  const book = kind === "book";
  const limit = book ? FREE_BOOK_LIMIT : FREE_PATTERN_LIMIT;
  const unit = book ? "冊" : "件";
  const noun = book ? "本・電子書籍" : "作品";
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

  const price = product?.displayPrice ?? "500円";

  if (premium.active) {
    return (
      <div className="paywall">
        <div className="paywall-badge">プレミアム</div>
        <h2 className="paywall-title">プレミアムをご利用中です</h2>
        <p>作品・本の登録数に上限はありません。追加の料金はかかりません。</p>
        {premium.legacySubscription && <LegacySubscriptionNotice />}
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
      <h2 className="paywall-title">{reason === "limit" ? `無料で登録できる${noun}は${limit}${unit}までです` : "作品も本も、いくつでも登録できます"}</h2>
      {reason === "limit" && (
        <p>
          いま登録されている{noun}は{patternCount ?? limit}{unit}です。{limit + 1}{unit}目以降を登録するには、プレミアム（買い切り {price}）をご購入ください。
        </p>
      )}

      <ul className="paywall-list">
        <li>
          作品（編み図）と本・電子書籍の登録数が<strong>無制限</strong>になります（無料版は作品{FREE_PATTERN_LIMIT}件・本{FREE_BOOK_LIMIT}冊まで）
        </li>
        <li>登録済みの作品の閲覧・編集・PDF・段数カウンターは、これまでどおり無料で使えます</li>
        <li>一度購入すれば、ずっと使えます（月額料金や自動更新はありません）</li>
        <li>同じ Apple ID のほかの iPhone・iPad でも「購入を復元する」で使えます</li>
        <li>削除すれば、無料版でもまた新しく登録できます</li>
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
            if (status === "purchased") toast("プレミアムを購入しました。ありがとうございます！");
            else if (status === "pending") toast("購入の承認待ちです。承認されると自動で有効になります。");
          } catch (e) {
            showError(e, "購入を完了できませんでした。時間をおいてもう一度お試しください。");
          } finally {
            setBusy(null);
          }
        }}
      >
        {busy === "buy" ? "処理中…" : product ? `${price}で購入する（買い切り）` : product === null ? "現在は購入できません" : "読み込み中…"}
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
        お支払いは購入の確定時に Apple ID に1回だけ請求されます。買い切りのため、自動更新や追加の請求はありません。以前の月額プランをご購入いただいた方は、そのままプレミアムをお使いいただけます。
      </p>
      <div className="paywall-links">
        <ExternalLinkButton url={TERMS_URL} label="利用規約（EULA）" pageName="利用規約" className="btn btn-ghost btn-small" />
        <ExternalLinkButton url={PRIVACY_URL} label="プライバシーポリシー" pageName="プライバシーポリシー" className="btn btn-ghost btn-small" />
      </div>
    </div>
  );
}

/** 以前の月額プランが有効なままの人への案内（買い切りに切り替わったため、解約しても使い続けられる） */
export function LegacySubscriptionNotice() {
  const { showError } = useFeedback();
  return (
    <div className="note-box">
      <p>
        <strong>月額プランをご利用いただいていた方へ</strong>
        <br />
        プレミアムは買い切りになりました。月額プランをご購入いただいた方は、解約してもこのままずっとプレミアムをお使いいただけます。今後の請求を止めるには、月額プランを解約してください（解約済みの場合は対応不要です）。
      </p>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => manageSubscriptions().catch((e) => showError(e, "サブスクリプションの管理画面を開けませんでした。iPhone の「設定」→ ご自身の名前 →「サブスクリプション」から解約できます。"))}
      >
        月額プランを解約する
      </button>
    </div>
  );
}
