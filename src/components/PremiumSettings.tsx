import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { useFeedback } from "./Feedback";
import { LegacySubscriptionNotice, usePremium } from "./Paywall";
import { countByKind, FREE_BOOK_LIMIT, FREE_PATTERN_LIMIT, restorePurchases } from "../lib/premium";
import { BACK_STATE } from "../hooks/navigation";

/** 設定画面のプレミアム欄（iOS アプリのみ） */
export function PremiumSettings() {
  const premium = usePremium();
  const counts = useLiveQuery(async () => countByKind(await db.patterns.toArray()), []);
  const { toast, showError } = useFeedback();
  if (!premium.enforced) return null;
  return (
    <section className="section">
      <h2 className="section-title">プレミアム</h2>
      <dl className="info-list">
        <div>
          <dt>ご利用中のプラン</dt>
          <dd>{premium.active ? "プレミアム（買い切り・登録数 無制限）" : `無料版（作品${FREE_PATTERN_LIMIT}件・本${FREE_BOOK_LIMIT}冊まで）`}</dd>
        </div>
        <div>
          <dt>登録作品</dt>
          <dd>{premium.active ? `${counts?.patterns ?? "…"}件` : `${counts?.patterns ?? "…"} / ${FREE_PATTERN_LIMIT}件`}</dd>
        </div>
        <div>
          <dt>本・電子書籍</dt>
          <dd>{premium.active ? `${counts?.books ?? "…"}冊` : `${counts?.books ?? "…"} / ${FREE_BOOK_LIMIT}冊`}</dd>
        </div>
      </dl>
      {premium.legacySubscription && <LegacySubscriptionNotice />}
      <div className="backup-actions">
        {!premium.active && (
          <Link to="/premium" state={BACK_STATE} className="btn btn-primary">
            プレミアムについて
          </Link>
        )}
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              const ok = await restorePurchases();
              toast(ok ? "購入を復元しました" : "復元できる購入が見つかりませんでした", ok ? "info" : "error");
            } catch (e) {
              showError(e, "購入を復元できませんでした。時間をおいてもう一度お試しください。");
            }
          }}
        >
          購入を復元する
        </button>
      </div>
    </section>
  );
}
